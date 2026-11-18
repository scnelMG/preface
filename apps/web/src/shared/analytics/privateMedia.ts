/**
 * 세션 녹화(Microsoft Clarity)에서 가릴 요소에 펼쳐 붙인다. 안쪽 글자·그림이 녹화에 남지 않는다.
 *
 * 얼굴이 나오는 것(촬영 영상, 내 3D 썸네일, 3D 뷰어)에 붙인다. 공개 샘플·안내 그림에는 붙이지 않는다.
 *
 * ```tsx
 * <div {...PRIVATE_MEDIA}><img src={thumbnailUrl} alt="" /></div>
 * ```
 */
export const PRIVATE_MEDIA = { 'data-clarity-mask': 'True' } as const

/**
 * 사람마다 달라지는 글자(닉네임·이메일, 모델·시안 이름, 상담 대화, 관상 풀이, 알림 내용, 입력칸)에 붙인다.
 * 하는 일은 `PRIVATE_MEDIA`와 같다. 이름만 나눠 무엇을 가리는지 읽히게 한다.
 *
 * Clarity 마스킹은 Balanced(입력칸 값만 기본으로 가림)로 두고, 버튼·안내 문구는 녹화에 보이게 한다(S15P31B204-553).
 * 사용자 글자를 보여 주는 화면을 새로 만들면 여기에 붙인다. 빠뜨리면 그 글자가 녹화에 그대로 남는다.
 *
 * ```tsx
 * <p {...PRIVATE_TEXT}>{simulation.title}</p>
 * ```
 */
export const PRIVATE_TEXT = PRIVATE_MEDIA
