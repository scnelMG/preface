package com.preface.api.share.service;

import static org.mockito.Mockito.mock;

import com.preface.api.hair.service.HairTemplateService;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.simulation.service.EyeEditService;
import com.preface.api.simulation.service.MorphStateCodec;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.share.repository.SimulationShareRepository;
import com.preface.common.simulation.repository.SimulationRepository;
import java.time.Clock;
import tools.jackson.databind.json.JsonMapper;

/** ShareService 생성자 인자를 한 곳에서 맞춘다. 보기(API-SHR-04)용 의존은 필드 mock으로 두고 보기 테스트가 꺼내 쓴다. */
class ShareServiceFixtures {

    final FaceModelRepository faceModels = mock(FaceModelRepository.class);
    final ReconstructionStorage storage = mock(ReconstructionStorage.class);
    final EyeEditService eyeEdit = mock(EyeEditService.class);
    final HairTemplateService hairTemplates = mock(HairTemplateService.class);
    final MorphStateCodec codec = new MorphStateCodec(JsonMapper.builder().build());

    ShareService service(
            SimulationRepository simulations,
            SimulationShareRepository shares,
            ShareConsentPolicy consent,
            ShareProperties properties,
            Clock clock) {
        return new ShareService(
                simulations,
                shares,
                consent,
                properties,
                clock,
                faceModels,
                storage,
                eyeEdit,
                hairTemplates,
                codec);
    }
}
