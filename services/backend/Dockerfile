# 백엔드 이미지 하나에 api·job-manager 두 jar를 담는다. 실행할 jar는 compose의 command로 고른다.
#   api          java -jar /app/api.jar
#   job-manager  java -jar /app/job-manager.jar
#   migration    java -jar /app/api.jar --spring.profiles.active=migrate (Flyway만 돌고 끝난다)
# 빌드: docker build -t preface-backend services/backend
# JDK 태그는 build.gradle.kts의 toolchain(25)과 같은 메이저를 쓴다. 같으면 Gradle이 JDK를 따로 받지 않는다.

FROM eclipse-temurin:25.0.3_9-jdk-noble AS build
WORKDIR /src
# 의존성 정의만 먼저 복사해 소스가 바뀌어도 Gradle 배포판·의존성 층을 다시 받지 않게 한다
# gradlew는 저장소에 실행 권한 없이(100644) 들어 있어 복사할 때 권한을 준다
COPY --chmod=755 gradlew ./
COPY settings.gradle.kts build.gradle.kts ./
COPY gradle gradle
COPY common/build.gradle.kts common/
COPY api/build.gradle.kts api/
COPY job-manager/build.gradle.kts job-manager/
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon -q :api:dependencies :job-manager:dependencies > /dev/null
COPY common common
COPY api api
COPY job-manager job-manager
# 테스트는 CI(be:test·be:it)에서 돈다. 이미지 빌드에서는 jar만 만든다
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon :api:bootJar :job-manager:bootJar \
 && mkdir /out \
 && cp "$(find api/build/libs -name '*.jar' ! -name '*-plain.jar')" /out/api.jar \
 && cp "$(find job-manager/build/libs -name '*.jar' ! -name '*-plain.jar')" /out/job-manager.jar

FROM eclipse-temurin:25.0.3_9-jre-noble
WORKDIR /app
# curl은 compose healthcheck(/actuator/health)에 쓴다. JRE 이미지에는 들어 있지 않다
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --no-create-home preface
COPY --from=build /out/ /app/
USER preface
# 컨테이너 메모리 제한(compose mem_limit)에 맞춰 힙을 잡는다
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -XX:+ExitOnOutOfMemoryError" \
    TZ=Asia/Seoul
EXPOSE 8080 8081
CMD ["java", "-jar", "/app/api.jar"]
