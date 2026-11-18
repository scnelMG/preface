plugins {
    // 팀원 PC에 JDK 25가 없어도 Gradle이 받아 쓴다(toolchain 자동 다운로드)
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "backend"

include("common", "api", "job-manager")
