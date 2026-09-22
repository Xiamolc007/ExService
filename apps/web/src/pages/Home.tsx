import { ActionButton, Card } from "@exre/exui";
import { GrainGradient } from "@paper-design/shaders-react";
import styles from "./Home.module.scss";

/**
 * 首页。
 *
 * 主体内容刻意留白：中间一块矩形占位、底部两个按钮占位，两者都不接任何行为。
 * 本次的范围是导航栏与页面骨架，真实内容与交互等设计确定后再填。
 *
 * 这里没有数据请求——`api/openapi.yaml` 里目前只有 `GET /health`，
 * 且该 health check 由 `main.tsx` 在开发期负责，不属于页面逻辑。
 */
export function Home() {
  return (
    <main className={styles.home} data-page="home">
      <div className={styles.heroStage}>
        <div className={styles.hero}>
          <div className={styles.shader} aria-hidden="true">
            <GrainGradient
              width={1280}
              height={720}
              colors={["#7300ff", "#eba8ff", "#00bfff", "#2b00ff"]}
              colorBack="#000000"
              softness={0.5}
              intensity={0.5}
              noise={0.25}
              shape="corners"
              speed={1}
            />
          </div>
        </div>

        <Card glass size="sm" className={styles.actionCard}>
          <div className={styles.actions}>
            <ActionButton
              type="button"
              variant={"ghost"}
              size="lg"
              className={`${styles.heroAction} ${styles.fivemAction}`}
            >
              FiveM打开
            </ActionButton>
            <ActionButton
              type="button"
              size="lg"
              variant="outline"
              className={styles.heroAction}
            >
              玩家社区
            </ActionButton>
          </div>
        </Card>
      </div>
    </main>
  );
}
