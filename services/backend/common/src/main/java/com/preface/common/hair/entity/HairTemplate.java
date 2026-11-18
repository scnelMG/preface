package com.preface.common.hair.entity;

import com.preface.common.jpa.BaseTimeEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 헤어 템플릿(REQ-F-20, S15P31B204-551). 공용 자산이라 개인정보가 아니다. 행은 자산을 올린 뒤 migration·운영 작업으로 넣는다.
 *
 * <p>헤어는 머리 템플릿({@code headTemplate}) 위에서 한 번 만들고, 바인딩 파일({@code bindingObjectKey})로 FE가 사용자 복원 머리에
 * 맞춘다. 복원 메시가 같은 템플릿 위상이어야 맞는다.
 */
@Getter
@Entity
@Table(name = "hair_template")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class HairTemplate extends BaseTimeEntity {

    @Id
    @Column(length = 36)
    private String id;

    @Column(nullable = false, length = 50)
    private String name;

    @Column(nullable = false, length = 500)
    private String meshObjectKey;

    @Column(length = 500)
    private String bindingObjectKey;

    @Column(length = 30)
    private String headTemplate;

    @Column(name = "hair_length", length = 10)
    private String length;

    @Column(length = 10)
    private String bangs;

    @Column(length = 10)
    private String part;

    @Column(length = 7)
    private String baseRgb;

    @Column(length = 500)
    private String thumbnailObjectKey;

    @Column(nullable = false)
    private int sortOrder;

    @Column(nullable = false)
    private boolean active;

    /** 테스트·자산 등록용. 운영 행은 migration으로 넣는다. */
    public static HairTemplate of(
            String id,
            String name,
            String meshObjectKey,
            String bindingObjectKey,
            String headTemplate,
            String length,
            String bangs,
            String part,
            String baseRgb,
            int sortOrder) {
        HairTemplate t = new HairTemplate();
        t.id = id;
        t.name = name;
        t.meshObjectKey = meshObjectKey;
        t.bindingObjectKey = bindingObjectKey;
        t.headTemplate = headTemplate;
        t.length = length;
        t.bangs = bangs;
        t.part = part;
        t.baseRgb = baseRgb;
        t.sortOrder = sortOrder;
        t.active = true;
        return t;
    }
}
