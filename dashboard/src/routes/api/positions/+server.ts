import { json } from '@sveltejs/kit';
import { getOpenPositions, getHlLivePositions, syncPositionsWithHl } from '$lib/server/db';

export async function GET() {
	// HL API에서 실시간 포지션 가져오기
	const hlPositions = await getHlLivePositions();

	// DB 포지션과 동기화 (외부 청산 감지)
	if (hlPositions.length >= 0) {
		syncPositionsWithHl(hlPositions);
	}

	// DB 포지션도 함께 반환 (히스토리 매칭용)
	const dbPositions = getOpenPositions();

	return json({
		positions: dbPositions,
		hlPositions,
	});
}
