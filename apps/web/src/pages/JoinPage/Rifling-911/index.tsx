import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Button,
  ExMessage,
} from "@exre/exui";
import { ArrowUpRight, CircleCheck } from "lucide-react";
import { HalftoneDots } from "@paper-design/shaders-react";
import {
  CompleteJoinApplicationModal,
  type CompleteJoinApplicationModalHandle,
  type JoinApplicationDraft,
  type JoinApplicationType,
} from "@workspace/components";
import {
  JoinApplicationTextLimitError,
  submitApplication,
} from "@web/src/join/client";
import { communityDestinations, communityLinks } from "@web/src/join/community";
import { getJoinHeroImages } from "@web/src/join/hero-images";
import styles from "@web/src/pages/JoinPage/Rifling-911/JoinPage.module.scss";

const heroImages = getJoinHeroImages("rifling-911");

export function JoinPage() {
  const [heroIndex, setHeroIndex] = useState(0);
  const [applicationType, setApplicationType] =
    useState<JoinApplicationType | null>(null);
  const [step, setStep] = useState(0),
    [received, setReceived] = useState(false),
    [busy, setBusy] = useState(false);
  const [serverAction, setServerAction] = useState<"query" | "login" | null>(
    null,
  );
  const pending = useRef(false),
    live = useRef(false),
    form = useRef<CompleteJoinApplicationModalHandle>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const drafts = useRef<
    Partial<
      Record<
        JoinApplicationType,
        {
          values: NonNullable<
            ReturnType<CompleteJoinApplicationModalHandle["getDraft"]>
          >;
          step: number;
        }
      >
    >
  >({});
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  function open(type: JoinApplicationType, button: HTMLButtonElement) {
    if (pending.current) return;
    trigger.current = button;
    setReceived(false);
    setServerAction(null);
    setStep(drafts.current[type]?.step ?? 0);
    setApplicationType(type);
  }
  function close() {
    if (!pending.current) {
      if (applicationType && !received) {
        const values = form.current?.getDraft();
        if (values) drafts.current[applicationType] = { values, step };
      }
      setApplicationType(null);
      setReceived(false);
      setServerAction(null);
    }
  }
  async function submit(draft: JoinApplicationDraft) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setServerAction(null);
    try {
      const result = await submitApplication(draft);
      if (!live.current) return;
      if (result.data?.status === "received") {
        delete drafts.current[draft.form.applicationType];
        setReceived(true);
        ExMessage.info("申请已收到，请等待社区审核安排");
        return;
      }
      const code = result.error?.error.code;
      if (
        result.response.status === 409 &&
        code === "JOIN_APPLICATION_EXISTS"
      ) {
        form.current?.setError("该邮箱已有申请，不能重复提交", "email");
        setServerAction("query");
      } else if (result.response.status === 409 && code === "EMAIL_IN_USE") {
        form.current?.setError("该邮箱已有正式账号，请前往登录", "email");
        setServerAction("login");
      } else {
        const message =
          result.response.status === 429
            ? "提交过于频繁，请稍后重试"
            : result.response.status === 413
              ? "申请文字资料或证明文件超出大小限制，请缩短回答或检查附件数量与大小后重试"
              : result.response.status === 415
                ? "证明文件格式不受支持，请检查后重试"
                : result.response.status === 503
                  ? "当前上传繁忙，请稍后重试"
                  : "提交失败，请检查资料并重试";
        form.current?.setError(message);
      }
    } catch (error) {
      if (live.current)
        form.current?.setError(
          error instanceof JoinApplicationTextLimitError
            ? error.message
            : "提交失败，请检查网络并重试",
        );
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }
  const heroImage = heroImages[heroIndex];
  const artwork = heroImage && (
    <HalftoneDots
      key={heroImage}
      width={1280}
      height={720}
      image={heroImage}
      colorBack="#f2f1e8"
      colorFront="#2b2b2b"
      originalColors
      type="gooey"
      grid="hex"
      inverted={false}
      size={0.5}
      radius={1.25}
      contrast={0.4}
      grainMixer={0.2}
      grainOverlay={0.2}
      grainSize={0.5}
      fit="cover"
    />
  );
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        {heroImage &&
          (heroImages.length > 1 ? (
            <button
              type="button"
              className={styles.heroArtwork}
              aria-label={`切换背景图片，当前第 ${heroIndex + 1} 张，共 ${heroImages.length} 张`}
              onClick={() =>
                setHeroIndex((index) => (index + 1) % heroImages.length)
              }
            >
              {artwork}
            </button>
          ) : (
            <div className={styles.heroArtwork} aria-hidden="true">
              {artwork}
            </div>
          ))}
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>Rifling 911 · Emergency Roleplay</p>
          <h1>
            每一次出勤，
            <br />
            都是新的故事。
          </h1>
          <p className={styles.introduction}>
            在紧急职业模拟中一起创造故事。
            <br />
            找到属于你的角色，成为社区的一员。
          </p>
          <div className={styles.actions} aria-label="申请入口">
            <Button
              className={styles.primaryAction}
              disabled={busy}
              onClick={(event) => open("new", event.currentTarget)}
            >
              新玩家申请 <ArrowUpRight aria-hidden="true" />
            </Button>
            <Button
              className={styles.secondaryAction}
              variant="outline"
              disabled={busy}
              onClick={(event) => open("experienced", event.currentTarget)}
            >
              调转申请 <ArrowUpRight aria-hidden="true" />
            </Button>
          </div>
          <p className={styles.experienceNote}>
            调转申请适用于拥有 100 小时以上相关经历的玩家
          </p>
          <p className={styles.query}>
            已经提交过申请？{" "}
            <Link to="/join/result">
              查询申请结果 <ArrowUpRight aria-hidden="true" />
            </Link>
          </p>
        </div>
      </header>
      <div className={styles.information}>
        <section className={styles.section} aria-labelledby="join-community">
          <h2 id="join-community">社区入口</h2>
          <div className={styles.communityActions}>
            {communityDestinations.map((link) =>
              link.url ? (
                <Button key={link.label} asChild variant="outline">
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    {link.label} <ArrowUpRight aria-hidden="true" />
                  </a>
                </Button>
              ) : (
                <Button key={link.label} variant="outline" disabled>
                  {link.label} <ArrowUpRight aria-hidden="true" />
                </Button>
              ),
            )}
          </div>
        </section>
        <section className={styles.section} aria-labelledby="join-requirements">
          <h2 id="join-requirements">申请须知</h2>
          <p>
            申请前请阅读社区置顶指引，确认理解社区规则。如实填写完整资料，申请阶段不设置密码，也不会创建正式账号。
          </p>
          <ul className={styles.requirements}>
            <li>
              <span aria-hidden="true">01</span>
              <div>
                <h3>年满 17 周岁且完成高中课程</h3>
                <p>具备成熟的理解能力。</p>
              </div>
            </li>
            <li>
              <span aria-hidden="true">02</span>
              <div>
                <h3>具备基本英语与清晰表达能力</h3>
                <p>在角色扮演中有效沟通。</p>
              </div>
            </li>
            <li>
              <span aria-hidden="true">03</span>
              <div>
                <h3>符合社区任职要求</h3>
                <p>不担任直接干涉其他服务器行政事务的主要职务。</p>
              </div>
            </li>
            <li>
              <span aria-hidden="true">04</span>
              <div>
                <h3>认同并遵守社区规范</h3>
                <p>包括社区道德、行为规范与服务器政策。</p>
              </div>
            </li>
          </ul>
          <p className={styles.finePrint}>
            以上条件由社区人工审核，出生日期与申请人类型不会自动决定审核结果。
          </p>
        </section>
        <section className={styles.section} aria-labelledby="join-process">
          <h2 id="join-process">从申请到加入。</h2>
          <ol className={styles.stages}>
            <li>
              <span aria-hidden="true">01</span>
              <h3>提交完整申请</h3>
              <p>了解条件，选择合适类别，填写完整资料。</p>
            </li>
            <li>
              <span aria-hidden="true">02</span>
              <h3>社区审核与安排</h3>
              <p>等待人工审核，线上面试及学院由社区组织。</p>
            </li>
            <li>
              <span aria-hidden="true">03</span>
              <h3>查收邮箱邀请</h3>
              <p>获批后验证邮箱，完善账号。</p>
            </li>
            <li>
              <span aria-hidden="true">04</span>
              <h3>跟进后续通知</h3>
              <p>登录后关注学院或社区的后续安排。</p>
            </li>
          </ol>
          <p className={styles.finePrint}>
            审核同意不代表邮件已送达，未收到邀请可进入完善注册流程按提示重发。
          </p>
        </section>
        <section
          className={`${styles.section} ${styles.faq}`}
          aria-labelledby="join-faq"
        >
          <h2 id="join-faq">你可能还想了解。</h2>
          <Accordion
            type="multiple"
            defaultValue={["faq-1"]}
            className={styles.accordion}
          >
            <AccordionItem value="faq-1">
              <AccordionTrigger>没有经验也可以申请吗？</AccordionTrigger>
              <AccordionContent>
                <p>
                  可以选择新玩家申请，按实际情况回答，后续指导由社区安排；已有相关经验的玩家选择调转申请。
                </p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="faq-2">
              <AccordionTrigger>何时安排面试、何时能有结果？</AccordionTrigger>
              <AccordionContent>
                <p>
                  以社区实际通知为准，不承诺固定时限。无法按时参加面试，请提前联系社区。等待期间可以阅读置顶指引、了解玩法和规则。
                </p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="faq-3">
              <AccordionTrigger>还未满足条件怎么办？</AccordionTrigger>
              <AccordionContent>
                <p>
                  请先了解条件并联系社区确认后续安排，资料与情况需要如实填写。
                </p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="faq-4">
              <AccordionTrigger>可以更换类别或再次申请吗？</AccordionTrigger>
              <AccordionContent>
                <p>
                  同一邮箱只能提交一次，拒绝、邀请到期和完成注册都不释放名额。请通过结果查询了解状态。
                </p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="faq-5">
              <AccordionTrigger>未收到邀请或邀请到期怎么办？</AccordionTrigger>
              <AccordionContent>
                <p>
                  已通过时前往完善注册，按既有流程检查资格或重发验证码；邀请到期请联系社区重新签发，无需重填申请。
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>
        <section className={styles.contact} aria-labelledby="join-contact">
          <div>
            <h2 id="join-contact">保持联系。</h2>
            <p>
              请留意社区置顶指引与通知，通过社区工作人员了解面试或邀请安排。
            </p>
          </div>
          {communityLinks.length > 0 && (
            <div className={styles.links}>
              {communityLinks.map((link) => (
                <Button key={link.label} asChild variant="outline">
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    {link.label}
                  </a>
                </Button>
              ))}
            </div>
          )}
        </section>
      </div>
      {applicationType !== null && (
        <CompleteJoinApplicationModal
          key={applicationType}
          ref={form}
          open
          applicationType={applicationType}
          resultTitle="申请已收到"
          initialDraft={drafts.current[applicationType]?.values}
          busy={busy}
          step={step}
          onStepChange={setStep}
          onOpenChange={(value) => {
            if (!value) close();
          }}
          onSubmit={submit}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
          serverAction={
            serverAction === "query" ? (
              <Link to="/join/result">查询已有申请结果</Link>
            ) : serverAction === "login" ? (
              <Link to="/login">前往登录</Link>
            ) : undefined
          }
        >
          {received ? (
            <section className={styles.applicationSuccess} aria-live="polite">
              <CircleCheck
                className={styles.successIcon}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <p className={styles.successLead}>资料提交成功</p>
              <p>
                申请资料已提交，接下来将等待安排远程语音面试。进行面试后，社区会确认申请结果，请留意后续通知。
              </p>
              <Button disabled>面试预约</Button>
            </section>
          ) : undefined}
        </CompleteJoinApplicationModal>
      )}
    </main>
  );
}
