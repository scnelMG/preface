package com.preface.jobmanager;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * job-manager 패키지 규칙. api {@code ArchitectureTest}와 같은 규칙을 이 모듈에도 건다(api 테스트는 이 모듈 클래스를 보지 못한다).
 *
 * <pre>
 * com.preface.jobmanager.&lt;도메인&gt;.service | repository
 * com.preface.jobmanager.global.config | lock
 * </pre>
 */
class JobManagerArchitectureTest {

    private static JavaClasses classes;

    @BeforeAll
    static void importClasses() {
        classes =
                new ClassFileImporter()
                        .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                        .importPackages("com.preface");
    }

    @Test
    void repository는_service에서만_쓴다() {
        classes()
                .that()
                .resideInAPackage("..repository..")
                .should()
                .onlyBeAccessed()
                .byAnyPackage("..service..", "..repository..")
                .check(classes);
    }

    @Test
    void common은_job_manager에_의존하지_않는다() {
        noClasses()
                .that()
                .resideInAPackage("com.preface.common..")
                .should()
                .dependOnClassesThat()
                .resideInAPackage("com.preface.jobmanager..")
                .check(classes);
    }

    @Test
    void 도메인_패키지_사이에_순환_의존이_없다() {
        slices().matching("com.preface.jobmanager.(*)..").should().beFreeOfCycles().check(classes);
    }
}
