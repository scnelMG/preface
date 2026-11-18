package com.preface.api.reconstruction.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.preface.api.reconstruction.service.WorkerPresence.Kind;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class WorkerPresenceTest {

    private final MovingClock clock = new MovingClock(Instant.parse("2026-11-03T00:00:00Z"));
    private final MeterRegistry meters = new SimpleMeterRegistry();
    private final WorkerPresence presence = new WorkerPresence(meters, clock);

    private double gauge(String kind, String server) {
        return meters.get("preface.workers.alive")
                .tag("kind", kind)
                .tag("server", server)
                .gauge()
                .value();
    }

    @Test
    void 워커_ID_앞부분으로_서버를_나누고_종류별로_센다() {
        presence.seen(Kind.GPU, "runpod-k73gf9mogs06og-prod-1");
        presence.seen(Kind.GPU, "runpod-k73gf9mogs06og-prod-2");
        presence.seen(Kind.GPU, "ssafy-jupyter-prod-1");
        presence.seen(Kind.EXTRACTOR, "ec2-prod-extractor");
        presence.seen(Kind.EXTRACTOR, "ssafy-jupyter-extractor-1");

        assertThat(gauge("gpu", "runpod")).isEqualTo(2);
        assertThat(gauge("gpu", "ssafy")).isEqualTo(1);
        assertThat(gauge("gpu", "ec2")).isZero();
        assertThat(gauge("extractor", "ec2")).isEqualTo(1);
        assertThat(gauge("extractor", "ssafy")).isEqualTo(1);
    }

    @Test
    void 같은_워커가_여러_번_불러도_한_번만_센다() {
        presence.seen(Kind.GPU, "runpod-a-prod-1");
        clock.advance(Duration.ofSeconds(5));
        presence.seen(Kind.GPU, "runpod-a-prod-1");

        assertThat(gauge("gpu", "runpod")).isEqualTo(1);
    }

    @Test
    void 삼분_동안_소식이_없으면_살아_있는_수에서_빠진다() {
        presence.seen(Kind.GPU, "runpod-a-prod-1");
        clock.advance(Duration.ofMinutes(3));
        assertThat(gauge("gpu", "runpod")).isEqualTo(1);

        clock.advance(Duration.ofSeconds(1));
        assertThat(gauge("gpu", "runpod")).isZero();
    }

    @Test
    void 아는_접두사가_아니면_other로_센다() {
        presence.seen(Kind.GPU, "laptop");
        presence.seen(Kind.GPU, "lab-pod-1");

        assertThat(gauge("gpu", "other")).isEqualTo(2);
    }

    @Test
    void 워커가_없어도_서버별_지표는_0으로_있다() {
        assertThat(gauge("gpu", "ssafy")).isZero();
        assertThat(gauge("extractor", "runpod")).isZero();
    }

    /** 테스트에서 시간을 앞으로 돌리는 시계. */
    static final class MovingClock extends Clock {
        private Instant now;

        MovingClock(Instant now) {
            this.now = now;
        }

        void advance(Duration duration) {
            now = now.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
