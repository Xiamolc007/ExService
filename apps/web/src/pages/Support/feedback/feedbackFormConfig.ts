import type { FeedbackKind } from "./schema";

export const developmentChoices: Array<{
  kind: FeedbackKind;
  label: string;
  description: string;
  icon: string;
}> = [
  {
    kind: "bug",
    label: "Bug 反馈",
    description: "描述遇到的问题与复现过程，帮助定位和修复。",
    icon: "Danger",
  },
  {
    kind: "feature",
    label: "功能",
    description: "提出新功能或现有功能的改进想法。",
    icon: "Discovery",
  },
  {
    kind: "asset",
    label: "资源",
    description: "提交车辆、角色、衣服等资源的新增或调整。",
    icon: "Folder",
  },
  {
    kind: "request",
    label: "需求",
    description: "描述你希望解决的具体问题或使用需要。",
    icon: "Tick",
  },
  {
    kind: "content",
    label: "文档和内容",
    description: "补充、修改或删除文档与内容。",
    icon: "Document",
  },
  {
    kind: "campaign",
    label: "宣传与活动",
    description: "提交宣传想法、活动方案或协作需要。",
    icon: "Volume",
  },
];
export const communityChoices: typeof developmentChoices = [
  {
    kind: "suggestion",
    label: "反馈和建议",
    description: "分享你的体验，提出对服务或社区的建议。",
    icon: "Message",
  },
  {
    kind: "complaint",
    label: "投诉",
    description: "说明你遇到的不当行为或不满意的体验。",
    icon: "Danger",
  },
];
export const actions = {
  add: "新增",
  modify: "修改",
  delete: "删除",
  other: "其他",
} as const;
export const classificationCopy = {
  bug: {
    label: "问题分类",
    description: "选择最接近问题的分类；不确定时可选「其他」。",
    placeholder: "请选择问题分类",
  },
  feature: {
    label: "功能分类",
    description: "选择这项功能所属的分类，方便我们评估和分派。",
    placeholder: "请选择功能分类（可留空）",
  },
  asset: {
    label: "资源类型",
    description: "例如车辆、角色或衣服；不确定时可以留空。",
    placeholder: "请选择资源类型（可留空）",
  },
  request: {
    label: "需求分类",
    description: "选择与你的需求最相关的分类，方便我们归类处理。",
    placeholder: "请选择需求分类（可留空）",
  },
};
export const fieldGuidance = {
  title: { placeholder: "用一句话概括你想反馈的内容" },
  contentText: { placeholder: "描述你的想法、使用场景，以及希望达到的效果。" },
  description: {
    description: "说明在什么场景下遇到了什么问题，以及它对你的影响。",
    placeholder: "例如：在车库取出车辆后，车辆没有出现，但界面提示取车成功。",
  },
  reproductionSteps: {
    description: "按操作顺序描述，方便我们尝试重现；无法稳定复现也可以说明。",
    placeholder: "1. 打开…\n2. 点击…\n3. 出现…",
  },
  expectedResult: {
    description: "完成上述操作后，你原本希望发生什么？",
    placeholder: "例如：车辆出现在车库出口，并可以正常驾驶。",
  },
  actualResult: {
    description: "实际发生了什么？可以补充提示文字或异常表现。",
    placeholder: "例如：出口没有车辆，重新打开车库后仍显示车辆已取出。",
  },
} satisfies Record<string, { placeholder: string; description?: string }>;
