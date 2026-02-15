/**
 * 파일 유틸리티
 * atomic write, JSON 읽기/쓰기 등 공유 파일 작업 함수
 */

import { resolve } from "path";
import { existsSync, renameSync, mkdirSync, readFileSync, unlinkSync } from "fs";

/**
 * 원자적 파일 쓰기 - 임시 파일에 쓴 후 rename하여 데이터 손상 방지
 * try-finally로 임시 파일 정리 보장
 */
export async function atomicWrite(filepath: string, data: unknown): Promise<void> {
  const dir = resolve(filepath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const tmpPath = `${filepath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

  try {
    await Bun.write(tmpPath, JSON.stringify(data, null, 2));
    renameSync(tmpPath, filepath);
  } catch (err) {
    // 실패 시 임시 파일 정리
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // 정리 실패는 무시
    }
    throw err;
  }
}

/**
 * JSON 파일 읽기 (존재하지 않으면 null 반환)
 */
export function readJsonFile<T>(filepath: string): T | null {
  if (!existsSync(filepath)) return null;
  try {
    const raw = readFileSync(filepath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * 안전한 파일 삭제 (존재하지 않아도 에러 없음)
 */
export function safeUnlink(filepath: string): void {
  try {
    if (existsSync(filepath)) unlinkSync(filepath);
  } catch {
    // ignore
  }
}
