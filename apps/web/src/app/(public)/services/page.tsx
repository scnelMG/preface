import { ServiceSection } from '@/features/services/ServiceSection'

export const metadata = { title: '서비스' }

/** 서비스 — Figma P3-17. 메인의 서비스 섹션과 같은 컴포넌트다 */
export default function ServicesPage() {
  return (
    <div className="w-full px-[5%] pt-(--space-40) pb-12 md:px-[4%]">
      {/* 글 시작선을 머리줄 로고와 같은 화면 5%(모바일)·4%(데스크톱)에 맞춘다 */}
      <ServiceSection />
    </div>
  )
}
