// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { JoinPage } from "@web/src/pages/JoinPage/Rifling-911/index";
import { ExMessage } from "@exre/exui";
import { ExAxiosError } from "@workspace/sdk/http/browser";
const post = vi.hoisted(() => vi.fn());
vi.mock("@web/src/api/client", () => ({ api: { POST: post } }));
vi.mock("@web/src/join/hero-images", () => ({
  getJoinHeroImages: () => [
    "/images/heros/join/rifling-911/465563.jpg",
    "/images/heros/join/rifling-911/X1.png",
  ],
}));
vi.mock("@paper-design/shaders-react", () => ({
  HalftoneDots: ({ image }: { image: string }) => <img alt="" src={image} />,
}));
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.setPointerCapture = () => {};
HTMLElement.prototype.releasePointerCapture = () => {};
HTMLElement.prototype.scrollIntoView = () => {};
async function choose(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  post.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function change(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
it("cycles through the local hero images when the hero is clicked", async () => {
  render(
    <MemoryRouter>
      <JoinPage />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  const hero = screen.getByRole("button", {
    name: "切换背景图片，当前第 1 张，共 2 张",
  });
  expect(hero.querySelector("img")?.getAttribute("src")).toBe(
    "/images/heros/join/rifling-911/465563.jpg",
  );
  await user.click(hero);
  expect(hero.querySelector("img")?.getAttribute("src")).toBe(
    "/images/heros/join/rifling-911/X1.png",
  );
  await user.click(hero);
  expect(hero.querySelector("img")?.getAttribute("src")).toBe(
    "/images/heros/join/rifling-911/465563.jpg",
  );
});
it("shows both community entrances before the requirements while links are unconfigured", () => {
  render(
    <MemoryRouter>
      <JoinPage />
    </MemoryRouter>,
  );
  const community = screen.getByRole("region", { name: "社区入口" });
  const requirements = screen.getByRole("region", { name: "申请须知" });
  expect(
    community.compareDocumentPosition(requirements) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    (
      within(community).getByRole("button", {
        name: "QQ 社区",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      within(community).getByRole("button", {
        name: "KOOK 社区",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("allows readers to expand and collapse a question", async () => {
  render(
    <MemoryRouter>
      <JoinPage />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  const question = screen.getByRole("button", {
    name: "可以更换类别或再次申请吗？",
  });
  expect(question.getAttribute("aria-expanded")).toBe("false");
  await user.click(question);
  expect(question.getAttribute("aria-expanded")).toBe("true");
  await user.click(question);
  expect(question.getAttribute("aria-expanded")).toBe("false");
});
it("keeps application actions independent of keyboard background switching", async () => {
  render(
    <MemoryRouter>
      <JoinPage />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  const hero = screen.getByRole("button", {
    name: "切换背景图片，当前第 1 张，共 2 张",
  });
  hero.focus();
  await user.keyboard("{Enter}");
  expect(hero.getAttribute("aria-label")).toContain("第 2 张");
  await user.keyboard(" ");
  expect(hero.getAttribute("aria-label")).toContain("第 1 张");
  await user.click(screen.getByRole("button", { name: "新玩家申请" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "关闭申请" }));
  expect(hero.getAttribute("aria-label")).toContain("第 1 张");
});
async function fill(
  type: "new" | "experienced",
  file?: File,
  oversized = false,
) {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", {
      name: type === "new" ? "新玩家申请" : "调转申请",
    }),
  );
  change("邮箱", "Member@example.com");
  change(type === "new" ? "你的名字" : "IC 名字", "成员");
  change("QQ 号码", "001234");
  await user.click(screen.getByRole("button", { name: /继续|检查申请/ }));
  expect(screen.getByRole("button", { name: "出生日期" }).textContent).toContain("2000-01-01");
  await choose(user, "申请人类型", "普通成年申请人");
  await choose(user, "申请部门", "警察部门");
  await user.click(screen.getByRole("button", { name: /继续|检查申请/ }));
  if (type === "new") {
    await choose(
      user,
      "是否接触过 FiveM，是否游玩过其他 RP 服务器？",
      "没有接触过",
    );
    await choose(
      user,
      "是否对“紧急职业模拟”这一种游玩方式有过了解？",
      "不了解",
    );
  } else await choose(user, "以前所在部门", "巡逻");
  for (const input of screen.getAllByRole("textbox"))
    fireEvent.change(input, {
      target: {
        value:
          oversized && input.tagName === "TEXTAREA"
            ? "中".repeat(4000)
            : "如实说明经历",
      },
    });
  await user.click(screen.getByRole("button", { name: /继续|检查申请/ }));
  if (type === "experienced") {
    for (const input of screen.getAllByRole("textbox"))
      fireEvent.change(input, {
        target: { value: oversized ? "中".repeat(4000) : "说明".repeat(80) },
      });
    if (file)
      await user.upload(screen.getByLabelText("证明文件（可选）"), file);
    await user.click(screen.getByRole("button", { name: /继续|检查申请/ }));
  }
  await choose(user, "每周空闲时间", "每晚都有空");
  await user.click(screen.getByRole("checkbox", { name: "B站" }));
  await user.click(screen.getByRole("button", { name: /继续|检查申请/ }));
  for (const checkbox of screen.getAllByRole("checkbox"))
    await user.click(checkbox);
  return user;
}
it("retains dismissed drafts in memory and isolates the two application types", async () => {
  render(
    <MemoryRouter>
      <JoinPage />
    </MemoryRouter>,
  );
  const user = userEvent.setup(),
    trigger = screen.getByRole("button", { name: "新玩家申请" });
  expect(
    screen.getByRole("link", { name: "查询申请结果" }).getAttribute("href"),
  ).toBe("/join/result");
  expect(screen.getByRole("heading", { name: "申请须知" })).toBeTruthy();
  await user.click(trigger);
  change("邮箱", "draft@example.com");
  await user.click(screen.getByRole("button", { name: "关闭申请" }));
  expect(document.activeElement).toBe(trigger);
  await user.click(screen.getByRole("button", { name: "调转申请" }));
  expect((screen.getByLabelText("邮箱") as HTMLInputElement).value).toBe("");
  change("邮箱", "transfer@example.com");
  await user.click(screen.getByRole("button", { name: "关闭申请" }));
  await user.click(trigger);
  expect((screen.getByLabelText("邮箱") as HTMLInputElement).value).toBe(
    "draft@example.com",
  );
  await user.click(screen.getByRole("button", { name: "关闭申请" }));
  await user.click(screen.getByRole("button", { name: "调转申请" }));
  expect((screen.getByLabelText("邮箱") as HTMLInputElement).value).toBe(
    "transfer@example.com",
  );
  expect(post).not.toHaveBeenCalled();
});
it("restores the dismissed step and attached files, but releases drafts on page unmount", async () => {
  const view = render(
    <MemoryRouter>
      <JoinPage />
    </MemoryRouter>,
  );
  const file = new File(["proof"], "retained.txt", { type: "text/plain" });
  const user = await fill("experienced", file);
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "调转申请" }));
  expect(screen.getByRole("button", { name: "提交申请" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "返回修改" }));
  await user.click(screen.getByRole("button", { name: "上一步" }));
  expect(
    screen.getByRole("button", { name: "移除 retained.txt" }),
  ).toBeTruthy();
  change("为什么应该接受您的调转？", "重新打开后继续填写");
  expect(
    (screen.getByLabelText("为什么应该接受您的调转？") as HTMLTextAreaElement)
      .value,
  ).toBe("重新打开后继续填写");
  view.unmount();
  render(
    <MemoryRouter>
      <JoinPage />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: "调转申请" }));
  expect((screen.getByLabelText("邮箱") as HTMLInputElement).value).toBe("");
  expect(post).not.toHaveBeenCalled();
});
it("submits a complete new payload only on confirmation and waits for server acknowledgement", async () => {
  const next = deferred<{ status: string }>();
  vi.spyOn(ExMessage, "info").mockReturnValue("info");
  post.mockReturnValue(next.promise);
  render(
    <MemoryRouter>
      <JoinPage />
    </MemoryRouter>,
  );
  const user = await fill("new");
  expect(post).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "提交申请" }));
  expect(screen.queryByRole("heading", { name: "申请已收到" })).toBeNull();
  expect(
    (screen.getByRole("button", { name: "关闭申请" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeTruthy();
  const [path, options] = post.mock.calls[0]!;
  expect(path).toBe("/join/applications");
  const parts = options.body as FormData;
  const encoded = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(parts.get('application') as Blob) });
  const application = JSON.parse(encoded);
  expect(application.email).toBe("member@example.com");
  expect(application.form).toMatchObject({
    applicationType: "new",
    birthDate: "2000-01-01",
    department: "leo",
    commitments: {
      informationAccurate: true,
      obeyCommunityRules: true,
      acceptAcademyAttendanceConsequences: true,
    },
  });
  expect(parts.getAll('proofs')).toEqual([]);
  expect(Array.from(parts.keys())).toEqual(["application"]);
  const applicationPart = parts.get("application");
  expect(applicationPart).toBeInstanceOf(File);
  expect((applicationPart as File).name).toBe("application.json");
  expect((applicationPart as File).type).toBe("application/json");
  expect(options.headers).toBeUndefined();
  await act(async () => {
    next.resolve({ status: "received" });
  });
  expect(
    await screen.findByRole("heading", { name: "申请已收到" }),
  ).toBeTruthy();
  const result = within(screen.getByRole("dialog"));
  expect(result.getByRole("button", { name: "面试预约" })).toBeTruthy();
  expect(
    result.queryByRole("button", { name: "关闭" }),
  ).toBeNull();
  expect(result.getByText(/进行面试后，社区会确认申请结果/)).toBeTruthy();
  expect(result.getByText(/请留意申请邮箱/)).toBeTruthy();
  expect(result.getByRole("link", { name: "查询申请结果" }).getAttribute("href")).toBe("/join/result");
});
it("retains experienced values and the same File on a failed submit and successful retry", async () => {
  vi.spyOn(ExMessage, "info").mockReturnValue("info");
  post
    .mockRejectedValueOnce(new Error("SQL secret"))
    .mockResolvedValueOnce({ status: "received" });
  render(
    <MemoryRouter>
      <JoinPage />
    </MemoryRouter>,
  );
  const file = new File(["proof"], "proof.txt", { type: "text/plain" }),
    user = await fill("experienced", file);
  await user.click(screen.getByRole("button", { name: "提交申请" }));
  expect(await screen.findByText("提交失败，请检查网络并重试")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "申请已收到" })).toBeNull();
  expect(screen.queryByText("SQL secret")).toBeNull();
  await user.click(screen.getByRole("button", { name: "提交申请" }));
  expect(
    await screen.findByRole("heading", { name: "申请已收到" }),
  ).toBeTruthy();
  const first = post.mock.calls[0]![1],
    second = post.mock.calls[1]![1];
  expect(second.body.getAll('proofs')).toHaveLength(1);
  const retained = second.body.get("proofs") as File;
  expect(retained.name).toBe(file.name);
  expect(retained.size).toBe(file.size);
  const contents = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(retained);
  });
  expect(contents).toBe("proof");
  expect(Array.from(second.body.keys())).toEqual([
    "application",
    "proofs",
  ]);
});
it.each([
  [
    "JOIN_APPLICATION_EXISTS",
    "该邮箱已有申请，不能重复提交",
    "查询已有申请结果",
    "/join/result",
  ],
  ["EMAIL_IN_USE", "该邮箱已有正式账号，请前往登录", "前往登录", "/login"],
])(
  "handles %s as a conflict without claiming receipt",
  async (code, message, link, href) => {
    post.mockRejectedValue(new ExAxiosError('http', code, 'safe', { status: 409 }));
    render(
      <MemoryRouter>
        <JoinPage />
      </MemoryRouter>,
    );
    const user = await fill("new");
    await user.click(screen.getByRole("button", { name: "提交申请" }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole("link", { name: link }).getAttribute("href")).toBe(
      href,
    );
    expect((screen.getByLabelText("邮箱") as HTMLInputElement).value).toBe(
      "Member@example.com",
    );
    expect(screen.queryByRole("heading", { name: "申请已收到" })).toBeNull();
  },
);
it.each([false, true])(
  "keeps oversized text and files editable before any request (proof=%s)",
  async (withProof) => {
    vi.spyOn(ExMessage, "info").mockReturnValue("info");
    post.mockResolvedValue({ status: "received" });
    render(
      <MemoryRouter>
        <JoinPage />
      </MemoryRouter>,
    );
    const file = withProof
      ? new File(["retained proof"], "retained.txt", { type: "text/plain" })
      : undefined;
    const user = await fill("experienced", file, true);
    await user.click(screen.getByRole("button", { name: "提交申请" }));
    expect(
      await screen.findByText(
        "申请文字资料总量超出限制，请缩短较长的回答后重试",
      ),
    ).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "申请已收到" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "返回修改" }));
    await user.click(screen.getByRole("button", { name: "上一步" }));
    expect(
      (
        screen.getByLabelText(
          "是否需要遵循“武力降级”原则？如果是，为什么？",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("中".repeat(4000));
    if (withProof)
      expect(
        screen.getByRole("button", { name: "移除 retained.txt" }),
      ).toBeTruthy();
    for (const input of screen.getAllByRole("textbox"))
      fireEvent.change(input, { target: { value: "说明".repeat(80) } });
    await user.click(screen.getByRole("button", { name: "上一步" }));
    for (const input of screen.getAllByRole("textbox"))
      fireEvent.change(input, { target: { value: "如实说明经历" } });
    await user.click(screen.getByRole("button", { name: /继续|检查申请/ }));
    await user.click(screen.getByRole("button", { name: /继续|检查申请/ }));
    await user.click(screen.getByRole("button", { name: /继续|检查申请/ }));
    await user.click(screen.getByRole("button", { name: "提交申请" }));
    expect(
      await screen.findByRole("heading", { name: "申请已收到" }),
    ).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(1);
    if (withProof) {
      const retained = post.mock.calls[0]![1].body.get(
        "proofs",
      ) as File;
      expect(retained.name).toBe("retained.txt");
      const contents = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(retained);
      });
      expect(contents).toBe("retained proof");
    }
  },
);
it("explains that a server 413 can involve text or attachments without discarding the draft", async () => {
  post.mockRejectedValue(new ExAxiosError('http', 'JOIN_UPLOAD_TOO_LARGE', 'private detail', { status: 413 }));
  render(
    <MemoryRouter>
      <JoinPage />
    </MemoryRouter>,
  );
  const user = await fill("new");
  await user.click(screen.getByRole("button", { name: "提交申请" }));
  expect(
    await screen.findByText(
      "申请文字资料或证明文件超出大小限制，请缩短回答或检查附件数量与大小后重试",
    ),
  ).toBeTruthy();
  expect(screen.queryByText("private detail")).toBeNull();
  expect(screen.getByRole("button", { name: "返回修改" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "申请已收到" })).toBeNull();
});
