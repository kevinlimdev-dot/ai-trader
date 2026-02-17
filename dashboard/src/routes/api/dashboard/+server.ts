import { json } from '@sveltejs/kit';
import { getDashboardData, getHlLivePositions, syncPositionsWithHl } from '$lib/server/db';

export async function GET() {
	// HL 실시간 포지션 + DB 동기화
	const hlPositions = await getHlLivePositions();
	syncPositionsWithHl(hlPositions);

	// sync 후 HL 데이터를 포함하여 대시보드 데이터 반환
	const data = getDashboardData(hlPositions);
	return json({ ...data, hlPositions });
}

