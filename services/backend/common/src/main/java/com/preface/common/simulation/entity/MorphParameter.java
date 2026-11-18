package com.preface.common.simulation.entity;

import com.preface.common.jpa.BaseTimeEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 슬라이더 항목과 허용 범위. 행은 migration으로만 넣는다. {@code code}가 {@code morph_state.weights}의 키다. */
@Getter
@Entity
@Table(name = "morph_parameter")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MorphParameter extends BaseTimeEntity {

    @Id
    @Column(length = 36)
    private String id;

    @Column(nullable = false, length = 60)
    private String code;

    @Column(nullable = false, length = 20)
    private String schemaVersion;

    /** EYE / NOSE / CONTOUR(2차). */
    @Column(nullable = false, length = 20)
    private String part;

    @Column(nullable = false, length = 30)
    private String subPart;

    @Column(nullable = false, length = 50)
    private String label;

    @Column(nullable = false, precision = 5, scale = 3)
    private BigDecimal minValue;

    @Column(nullable = false, precision = 5, scale = 3)
    private BigDecimal maxValue;

    @Column(nullable = false, precision = 5, scale = 3)
    private BigDecimal defaultValue;

    @Column(nullable = false, precision = 5, scale = 3)
    private BigDecimal step;

    @Column(nullable = false)
    private int sortOrder;

    @Column(nullable = false)
    private boolean active;
}
