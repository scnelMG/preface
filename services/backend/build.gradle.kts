// 공통 빌드 설정. 모듈별 의존성은 각 모듈 build.gradle.kts에 둔다.
//   common       엔티티·저장소·공통 응답·에러·Flyway migration (api, job-manager가 함께 쓴다)
//   api          Spring Boot API (외부 /api/v1, 내부 /internal/v1)
//   job-manager  3D 복원 작업 관리자 (같은 이미지, 별도 프로세스)
plugins {
    alias(libs.plugins.spring.boot) apply false
    alias(libs.plugins.spring.dependency.management) apply false
    alias(libs.plugins.spotless)
}

allprojects {
    group = "com.preface"
    version = "0.0.1-SNAPSHOT"

    repositories {
        mavenCentral()
    }
}

subprojects {
    apply(plugin = "java")
    apply(plugin = "jacoco")
    apply(plugin = "io.spring.dependency-management")
    apply(plugin = "com.diffplug.spotless")

    extensions.configure<JavaPluginExtension> {
        toolchain {
            languageVersion = JavaLanguageVersion.of(25)
        }
    }

    extensions.configure<io.spring.gradle.dependencymanagement.dsl.DependencyManagementExtension> {
        imports {
            mavenBom(org.springframework.boot.gradle.plugin.SpringBootPlugin.BOM_COORDINATES)
        }
    }

    extensions.configure<com.diffplug.gradle.spotless.SpotlessExtension> {
        java {
            target("src/**/*.java")
            googleJavaFormat().aosp()
            removeUnusedImports()
            trimTrailingWhitespace()
            endWithNewline()
        }
    }

    extensions.configure<JacocoPluginExtension> {
        toolVersion = rootProject.libs.versions.jacoco.get()
    }

    dependencies {
        "compileOnly"("org.projectlombok:lombok")
        "annotationProcessor"("org.projectlombok:lombok")
        "testCompileOnly"("org.projectlombok:lombok")
        "testAnnotationProcessor"("org.projectlombok:lombok")
        "testImplementation"("org.springframework.boot:spring-boot-starter-test")
        "testRuntimeOnly"("org.junit.platform:junit-platform-launcher")
    }

    tasks.withType<JavaCompile>().configureEach {
        options.encoding = "UTF-8"
        options.compilerArgs.add("-parameters")
    }

    // test = 단위 테스트(외부 의존 없음). @Tag("integration")은 integrationTest로 분리한다.
    tasks.named<Test>("test") {
        useJUnitPlatform { excludeTags("integration") }
        finalizedBy("jacocoTestReport")
    }

    val integrationTest by tasks.registering(Test::class) {
        description = "MySQL·Redis가 필요한 통합 테스트(@Tag(\"integration\"))"
        group = "verification"
        val testSourceSet = project.the<SourceSetContainer>()["test"]
        testClassesDirs = testSourceSet.output.classesDirs
        classpath = testSourceSet.runtimeClasspath
        useJUnitPlatform { includeTags("integration") }
        shouldRunAfter("test")
    }

    tasks.named<JacocoReport>("jacocoTestReport") {
        reports {
            xml.required = true
            html.required = false
        }
    }
}
