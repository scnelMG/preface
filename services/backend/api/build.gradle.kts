plugins {
    alias(libs.plugins.spring.boot)
}

dependencies {
    implementation(project(":common"))
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-restclient")
    implementation("org.springframework.boot:spring-boot-starter-security")
    // JWT 서명·검증(Nimbus). 소셜 로그인은 FE가 받은 인가 코드를 서버가 교환하는 방식이라 oauth2-client(서버 리다이렉트·세션 방식)는 쓰지 않는다.
    implementation("org.springframework.security:spring-security-oauth2-jose")
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    // /actuator/prometheus: EC2 Prometheus가 docker 망 안에서만 수집한다(S15P31B204-454). 프록시는 /api/*만 내보낸다
    runtimeOnly("io.micrometer:micrometer-registry-prometheus")
    implementation(libs.springdoc.webmvc.ui)
    // S3 호환 스토리지 presigned URL 발급(API-CAP-01). 파일 바이트는 서버를 거치지 않는다
    implementation(platform(libs.aws.sdk.bom))
    implementation("software.amazon.awssdk:s3")
    annotationProcessor("org.springframework.boot:spring-boot-configuration-processor")

    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testImplementation("org.springframework.boot:spring-boot-starter-security-test")
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testImplementation("org.testcontainers:testcontainers-mysql")
    testImplementation(libs.archunit.junit5)
}
