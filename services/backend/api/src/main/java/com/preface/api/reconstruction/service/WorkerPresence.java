package com.preface.api.reconstruction.service;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * 워커가 마지막으로 내부 API를 부른 시각으로 살아 있는 워커 수를 낸다(S15P31B204-455). 지표 {@code preface_workers_alive{kind,
 * server}}.
 *
 * <p>워커는 RunPod·SSAFY에서 SSH 터널로만 붙어 EC2가 워커 지표를 직접 가져갈 수 없다. 대신 api가 이미 받는 요청(claim·진행 보고·결과)으로
 * 판단한다. GPU 워커는 작업 중에도 진행 보고를 {@code heartbeatInterval}(120초)마다 보내므로 {@link #ALIVE_WINDOW} 안에 한 번은
 * 온다. 추출 워커는 작업 중 보고가 없어 추출이 3분을 넘으면 그동안 빠진다.
 *
 * <p>서버는 워커 ID 앞부분이다({@code runpod-…}, {@code ssafy-…}, {@code ec2-…},
 * run-worker.sh·ssafy-gpu.sh·compose가 붙인다). 기록은 메모리에만 있다. api가 다시 켜지면 0에서 시작해 워커가 다음 claim을 보내는 몇 초
 * 안에 돌아온다.
 */
@Component
public class WorkerPresence {

    static final Duration ALIVE_WINDOW = Duration.ofMinutes(3);

    /** 이보다 오래 소식이 없는 워커는 기록에서 지운다(워커 ID가 Pod 이름을 담아 Pod를 바꿀 때마다 늘어난다). */
    static final Duration FORGET_AFTER = Duration.ofHours(1);

    static final List<String> SERVERS = List.of("runpod", "ssafy", "ec2", "other");

    /** 워커 종류. 지표 라벨 {@code kind} 값. */
    public enum Kind {
        GPU("gpu"),
        EXTRACTOR("extractor");

        private final String label;

        Kind(String label) {
            this.label = label;
        }
    }

    private final Map<Kind, Map<String, Instant>> lastSeen =
            Map.of(Kind.GPU, new ConcurrentHashMap<>(), Kind.EXTRACTOR, new ConcurrentHashMap<>());
    private final Clock clock;

    public WorkerPresence(MeterRegistry meters, Clock clock) {
        this.clock = clock;
        for (Kind kind : Kind.values()) {
            for (String server : SERVERS) {
                Gauge.builder("preface.workers.alive", this, p -> p.alive(kind, server))
                        .description("최근 3분 안에 내부 API를 부른 워커 수")
                        .tag("kind", kind.label)
                        .tag("server", server)
                        .register(meters);
            }
        }
    }

    /** 워커가 내부 API를 불렀다. 형식이 맞는 ID만 들어온다(컨트롤러가 먼저 검사한다). */
    public void seen(Kind kind, String workerId) {
        lastSeen.get(kind).put(workerId, clock.instant());
    }

    long alive(Kind kind, String server) {
        Instant now = clock.instant();
        Map<String, Instant> workers = lastSeen.get(kind);
        workers.values().removeIf(at -> at.isBefore(now.minus(FORGET_AFTER)));
        Instant since = now.minus(ALIVE_WINDOW);
        return workers.entrySet().stream()
                .filter(e -> !e.getValue().isBefore(since))
                .filter(e -> server.equals(server(e.getKey())))
                .count();
    }

    static String server(String workerId) {
        int dash = workerId.indexOf('-');
        String prefix = dash < 0 ? workerId : workerId.substring(0, dash);
        return SERVERS.contains(prefix) ? prefix : "other";
    }
}
