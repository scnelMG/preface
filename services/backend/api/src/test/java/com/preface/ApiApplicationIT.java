package com.preface;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

/**
 * 실제 MySQL·Redis에서 앱이 뜨고 migration이 적용되는지 확인한다.
 *
 * <p>테이블·FK·CHECK 수는 ERD v2.7(팀 ERD)과 같아야 한다. 스키마를 바꾸면 이 숫자도 함께 고친다.
 */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@Import(TestcontainersConfiguration.class)
class ApiApplicationIT {

    @Autowired JdbcTemplate jdbcTemplate;

    @Autowired StringRedisTemplate redisTemplate;

    @Test
    void migration이_ERD와_같은_스키마를_만든다() {
        assertThat(count("information_schema.tables", "table_name <> 'flyway_schema_history'"))
                .isEqualTo(20);
        assertThat(count("information_schema.referential_constraints", null)).isEqualTo(25);
        assertThat(count("information_schema.check_constraints", null)).isEqualTo(19);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select column_default from information_schema.columns"
                                        + " where table_schema = database() and table_name = 'simulation'"
                                        + " and column_name = 'consult_after_seq'",
                                String.class))
                .isEqualTo("0");
        // 단계 기록은 작업과 함께 지워진다(V27)
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select delete_rule from information_schema.referential_constraints"
                                        + " where constraint_schema = database()"
                                        + " and constraint_name = 'fk_job_stage_job'",
                                String.class))
                .isEqualTo("CASCADE");
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select is_nullable from information_schema.columns"
                                        + " where table_schema = database() and table_name = 'face_model'"
                                        + " and column_name = 'rig_object_key'",
                                String.class))
                .isEqualTo("YES");
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select data_type from information_schema.columns"
                                        + " where table_schema = database() and table_name = 'face_model'"
                                        + " and column_name = 'approved_nose_capabilities'",
                                String.class))
                .isEqualTo("json");
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select data_type from information_schema.columns"
                                        + " where table_schema = database() and table_name = 'face_model'"
                                        + " and column_name = 'approved_eye_capabilities'",
                                String.class))
                .isEqualTo("json");
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select data_type from information_schema.columns"
                                        + " where table_schema = database() and table_name = 'face_model'"
                                        + " and column_name = 'eye_parts_sha256'",
                                String.class))
                .isEqualTo("char");
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select is_nullable from information_schema.columns"
                                        + " where table_schema = database() and table_name = 'face_model'"
                                        + " and column_name = 'source_mesh_object_key'",
                                String.class))
                .isEqualTo("YES");
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select is_nullable from information_schema.columns"
                                        + " where table_schema = database() and table_name = 'face_model'"
                                        + " and column_name = 'source_rig_object_key'",
                                String.class))
                .isEqualTo("YES");
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select is_nullable from information_schema.columns"
                                        + " where table_schema = database() and table_name = 'face_model'"
                                        + " and column_name = 'previous_mesh_object_key'",
                                String.class))
                .isEqualTo("YES");
        // 표정 트래킹 리그(V38, S15P31B204-879): 예전 모델은 NULL
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select concat(data_type, ':', is_nullable) from information_schema.columns"
                                        + " where table_schema = database() and table_name = 'face_model'"
                                        + " and column_name = 'expression_object_key'",
                                String.class))
                .isEqualTo("varchar:YES");
        // 웹 녹화 촬영 기록(V28, S15P31B204-640): JSON, 예전 업로드는 NULL
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select concat(data_type, ':', is_nullable) from information_schema.columns"
                                        + " where table_schema = database() and table_name = 'face_upload'"
                                        + " and column_name = 'capture_trace'",
                                String.class))
                .isEqualTo("json:YES");
    }

    @Test
    void CHECK_제약이_잘못된_상태값을_막는다() {
        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        "insert into user(id, status) values (uuid(), 'ACTVE')"))
                .hasMessageContaining("ck_user_status");
    }

    @Test
    void Redis에_연결된다() {
        redisTemplate.opsForValue().set("it:ping", "pong");
        assertThat(redisTemplate.opsForValue().get("it:ping")).isEqualTo("pong");
    }

    private int count(String table, String extraWhere) {
        String schemaColumn = table.endsWith("tables") ? "table_schema" : "constraint_schema";
        String sql =
                "select count(*) from "
                        + table
                        + " where "
                        + schemaColumn
                        + " = database()"
                        + (extraWhere == null ? "" : " and " + extraWhere);
        Integer result = jdbcTemplate.queryForObject(sql, Integer.class);
        return result == null ? 0 : result;
    }
}
