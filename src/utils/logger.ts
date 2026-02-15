type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// 전역 로그 레벨
let globalLogLevel: LogLevel | null = null;

/**
 * 글로벌 로그 레벨을 결정한다.
 * config.ts에서 loadConfig() 후 initLogLevel()을 호출하여 설정한다.
 * 호출 전에는 환경변수 LOG_LEVEL 또는 기본값 "info"를 사용한다.
 */
function getGlobalLogLevel(): LogLevel {
  if (globalLogLevel) return globalLogLevel;

  // 환경변수에서 읽기 (config.ts 순환 참조 방지)
  const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
  if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
    globalLogLevel = envLevel;
  } else {
    globalLogLevel = "info";
  }

  return globalLogLevel;
}

export class Logger {
  private context: string;
  private level: LogLevel;

  constructor(context: string, level?: LogLevel) {
    this.context = context;
    this.level = level || getGlobalLogLevel();
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private format(level: LogLevel, message: string, data?: unknown): string {
    const ts = new Date().toISOString();
    const prefix = `[${ts}] [${level.toUpperCase()}] [${this.context}]`;
    if (data !== undefined) {
      return `${prefix} ${message} ${JSON.stringify(data)}`;
    }
    return `${prefix} ${message}`;
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog("debug")) {
      console.log(this.format("debug", message, data));
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog("info")) {
      console.log(this.format("info", message, data));
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog("warn")) {
      console.warn(this.format("warn", message, data));
    }
  }

  error(message: string, data?: unknown): void {
    if (this.shouldLog("error")) {
      console.error(this.format("error", message, data));
    }
  }
}

export function createLogger(context: string, level?: LogLevel): Logger {
  return new Logger(context, level);
}

/**
 * 전역 로그 레벨을 설정한다.
 * config.ts의 loadConfig()에서 호출하여 config.yaml의 log_level을 적용한다.
 */
export function setGlobalLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}
