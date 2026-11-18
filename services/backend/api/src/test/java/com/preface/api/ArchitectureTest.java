package com.preface.api;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * 패키지 구조 규칙. AGENTS.md "패키지 구조"를 기계로 강제한다. 규칙을 바꾸면 AGENTS.md도 함께 고친다.
 *
 * <pre>
 * com.preface.api.&lt;도메인&gt;.controller | service | dto   (api 모듈)
 * com.preface.common.&lt;도메인&gt;.entity | repository        (common 모듈, api·job-manager 공용)
 * com.preface.api.global                                  (보안·에러 처리 등 공통 설정)
 * </pre>
 */
class ArchitectureTest {

    private static JavaClasses classes;

    @BeforeAll
    static void importClasses() {
        classes =
                new ClassFileImporter()
                        .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                        .importPackages("com.preface");
    }

    @Test
    void controller는_repository를_직접_쓰지_않는다() {
        noClasses()
                .that()
                .resideInAPackage("..controller..")
                .should()
                .dependOnClassesThat()
                .resideInAPackage("..repository..")
                .allowEmptyShould(true)
                .check(classes);
    }

    @Test
    void controller는_entity를_직접_다루지_않고_dto를_쓴다() {
        noClasses()
                .that()
                .resideInAPackage("..controller..")
                .should()
                .dependOnClassesThat()
                .resideInAPackage("..entity..")
                .allowEmptyShould(true)
                .check(classes);
    }

    @Test
    void repository는_service에서만_쓴다() {
        classes()
                .that()
                .resideInAPackage("..repository..")
                .should()
                .onlyBeAccessed()
                .byAnyPackage("..service..", "..repository..")
                .allowEmptyShould(true)
                .check(classes);
    }

    @Test
    void common은_api에_의존하지_않는다() {
        noClasses()
                .that()
                .resideInAPackage("com.preface.common..")
                .should()
                .dependOnClassesThat()
                .resideInAPackage("com.preface.api..")
                .allowEmptyShould(true)
                .check(classes);
    }

    @Test
    void 도메인_패키지_사이에_순환_의존이_없다() {
        slices().matching("com.preface.api.(*)..")
                .should()
                .beFreeOfCycles()
                .allowEmptyShould(true)
                .check(classes);
    }
}
