import { axonLog } from './logger';

/**
 * 성능 측정 클래스
 * 각 작업의 시작/종료 시간을 추적하고 소요 시간을 계산합니다.
 */
export class PerformanceTracker {
    private startTime: number;
    private checkpoints: Map<string, number> = new Map();
    private taskName: string;

    constructor(taskName: string) {
        this.taskName = taskName;
        this.startTime = Date.now();
        axonLog(`⏱️ [성능 측정] ${taskName} 시작`);
    }

    /**
     * 체크포인트 기록
     */
    checkpoint(name: string): void {
        const now = Date.now();
        const elapsed = now - this.startTime;
        this.checkpoints.set(name, now);
        axonLog(`⏱️ [성능 측정] ${this.taskName} - ${name}: ${elapsed}ms (총 경과시간)`);
    }

    /**
     * 이전 체크포인트로부터의 경과 시간 계산
     */
    checkpointFromLast(name: string, lastCheckpointName?: string): void {
        const now = Date.now();
        const totalElapsed = now - this.startTime;
        
        let fromLastElapsed = 0;
        if (lastCheckpointName && this.checkpoints.has(lastCheckpointName)) {
            const lastTime = this.checkpoints.get(lastCheckpointName)!;
            fromLastElapsed = now - lastTime;
        } else {
            // 마지막 체크포인트 찾기
            const checkpointValues = Array.from(this.checkpoints.values());
            if (checkpointValues.length > 0) {
                const lastTime = checkpointValues[checkpointValues.length - 1];
                fromLastElapsed = now - lastTime;
            } else {
                fromLastElapsed = totalElapsed;
            }
        }
        
        this.checkpoints.set(name, now);
        axonLog(`⏱️ [성능 측정] ${this.taskName} - ${name}: ${fromLastElapsed}ms (구간 시간) / ${totalElapsed}ms (총 경과시간)`);
    }

    /**
     * 완료 및 총 시간 출력
     */
    end(additionalInfo?: string): void {
        const totalTime = Date.now() - this.startTime;
        const info = additionalInfo ? ` - ${additionalInfo}` : '';
        axonLog(`⏱️ [성능 측정] ${this.taskName} 완료: 총 ${totalTime}ms${info}`);
        this.printSummary();
    }

    /**
     * 요약 출력
     */
    private printSummary(): void {
        axonLog(`⏱️ [성능 측정] ${this.taskName} 구간별 요약:`);
        
        let previousTime = this.startTime;
        let previousName = '시작';
        
        for (const [name, time] of this.checkpoints.entries()) {
            const elapsed = time - previousTime;
            axonLog(`   ${previousName} → ${name}: ${elapsed}ms`);
            previousTime = time;
            previousName = name;
        }
        
        const totalTime = Date.now() - this.startTime;
        axonLog(`   전체 소요 시간: ${totalTime}ms`);
    }

    /**
     * 현재까지의 경과 시간 반환
     */
    getElapsedTime(): number {
        return Date.now() - this.startTime;
    }
}


