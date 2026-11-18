plugins {
    alias(libs.plugins.spring.boot)
}

dependencies {
    implementation(project(":common"))
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    // /actuator/prometheus: EC2 Prometheus가 docker 망 안에서만 수집한다(S15P31B204-454). 프록시는 /api/*만 내보낸다
    runtimeOnly("io.micrometer:micrometer-registry-prometheus")
    // 삭제 스케줄러의 S3 DeleteObject. 설정(preface.storage.*)은 api와 같은 환경 변수를 쓴다
    implementation(platform(libs.aws.sdk.bom))
    implementation("software.amazon.awssdk:s3")
    annotationProcessor("org.springframework.boot:spring-boot-configuration-processor")

    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testImplementation("org.testcontainers:testcontainers-mysql")
    testImplementation(libs.archunit.junit5)
}
