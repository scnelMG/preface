package com.preface.common.admin.repository;

import com.preface.common.admin.entity.AdminAccessLog;
import org.springframework.data.repository.Repository;

/** 관리자 조회 기록. 추가만 한다(수정·삭제 메서드를 열지 않는다). */
public interface AdminAccessLogRepository extends Repository<AdminAccessLog, String> {

    AdminAccessLog save(AdminAccessLog log);
}
