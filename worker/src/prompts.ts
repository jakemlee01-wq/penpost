/**
 * Prompts for each orchestrator action. Every reply is a single JSON object so the
 * orchestrator (plain code) can act on it. The checker prompts never include the maker's
 * explanation: only the work product, the spec and the step's check.
 */

export interface Spec {
  problem: string;
  solution: string;
  acceptance: string[];
}

const JSON_ONLY = "Reply with one JSON object and nothing else.";

/** How work products are framed, so a reader never mistakes a label for part of the work. */
const TAGS_NOTE =
  "Work products are wrapped in <deliverable> tags. The tags and their step and title attributes are labels added by the system, not part of the work: judge, count and quote only the text between the tags.";

function deliverable(idx: number, title: string, text: string): string {
  return `<deliverable step="${idx}" title="${title.replace(/"/g, "'")}">\n${text}\n</deliverable>`;
}

function specBlock(spec: Spec): string {
  return [
    `PROBLEM:\n${spec.problem}`,
    `DESIRED SOLUTION:\n${spec.solution}`,
    `ACCEPTANCE CHECKS (all must pass for the project to be done):\n${spec.acceptance.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
  ].join("\n\n");
}

export const intake = {
  system: `You turn a person's description of a problem into a clear brief for a two-model team (a maker and an independent checker) that will solve it in text: code, writing, research, plans. Write plain, specific language. Acceptance checks must each be pass or fail and checkable from the delivered work or from independent evidence, not from anyone's say-so. Use 2 to 6 checks. ${JSON_ONLY}
Shape: {"problem": string, "solution": string, "acceptance": string[]}`,
  prompt(request: string, revision: string | null): string {
    return `The person wrote:\n"""\n${request}\n"""${revision ? `\n\nThey reviewed an earlier draft and asked for this change:\n"""\n${revision}\n"""` : ""}`;
  },
};

export const plan = {
  system: `You plan work for a two-model team. Break the work into the fewest high-level steps that get every acceptance check to pass (usually 2 to 8). Each step needs its own pass or fail check that an independent reviewer can verify from the step's output alone.
Sort every step into a bucket:
- "model": the models can do it alone in text (writing copy, building code, research, analysis).
- "user": the person must do it (creating accounts, adding payment details, identity verification, handing over a limited access token). Models never sign up for accounts.
- "blocker": needs a real person for legal, tax, or business registration steps.
Give each step a kind: "build" (code), "write" (prose), or "research". List dependencies by step number. Estimate output tokens for the model steps. Only plan steps that move an acceptance check; do not add busywork. If the honest answer is that nothing worth doing can be done, return an empty steps array and say why in "note". ${JSON_ONLY}
Shape: {"steps": [{"title": string, "detail": string, "check": string, "kind": "build"|"write"|"research", "bucket": "model"|"user"|"blocker", "depends_on": number[], "est_tokens": number}], "note": string}
Steps are numbered from 1 in the order given.`,
  prompt(spec: Spec, reviewerNotes: string | null): string {
    return `${specBlock(spec)}${reviewerNotes ? `\n\nAn independent reviewer rejected your last plan. Their notes:\n${reviewerNotes}` : ""}`;
  },
};

export const planReview = {
  system: `You are the independent checker on a two-model team. Review a plan before any work starts. Approve only if: every acceptance check is covered by some step, every step has a check that can be verified from its output alone, buckets are right (models never create accounts, enter payment details or handle legal, tax or registration matters), dependencies make sense, and there is no busywork. ${JSON_ONLY}
Shape: {"approved": boolean, "notes": string}`,
  prompt(spec: Spec, steps: unknown): string {
    return `${specBlock(spec)}\n\nPLAN:\n${JSON.stringify(steps, null, 2)}`;
  },
};

export interface MakeInput {
  spec: Spec;
  step: { idx: number; title: string; detail: string; check: string };
  dependencies: { idx: number; title: string; artifact: string }[];
  checkerNotes: string | null;
  previousArtifact: string | null;
}

export const make = {
  system: `You are the maker on a two-model team. Produce the complete work product for one step. An independent checker will judge only your artifact against the step's check, so put everything needed in the artifact itself (full code, full text, sources with links for research). Keep explanations out of the artifact; put them in "notes". ${TAGS_NOTE}
Never pretend to spend money, use real credentials, put anything live, or contact anyone. If the step cannot be done without one of those, set "needs_human" to a one-line reason and leave the artifact empty. ${JSON_ONLY}
Shape: {"artifact": string, "notes": string, "needs_human": string | null}`,
  prompt(i: MakeInput): string {
    const deps = i.dependencies.length
      ? `\n\nOUTPUT OF EARLIER STEPS YOU CAN BUILD ON:\n${i.dependencies.map((d) => deliverable(d.idx, d.title, d.artifact)).join("\n\n")}`
      : "";
    const retry = i.checkerNotes
      ? `\n\nYOUR LAST ATTEMPT FAILED THE CHECK. The checker's notes:\n${i.checkerNotes}\n\nYour last artifact:\n${i.previousArtifact ?? "(none)"}`
      : "";
    return `${specBlock(i.spec)}${deps}\n\nYOUR STEP (${i.step.idx}): ${i.step.title}\n${i.step.detail}\n\nSTEP CHECK (must pass):\n${i.step.check}${retry}`;
  },
};

export interface CheckInput {
  spec: Spec;
  step: { idx: number; title: string; detail: string; check: string };
  artifact: string;
  dependencies: { idx: number; title: string; artifact: string }[];
}

export const check = {
  system: `You are the independent checker on a two-model team, modeled on segregation of duties in accounting. Judge the artifact only against the step's check, using independent evidence: the written spec, the artifact's actual content, sources you can verify, and your own working (for code, trace it or reason through test cases). You are not shown the maker's explanation and must not accept claims inside the artifact as evidence that it works. Pass only if the check is clearly met. If it fails, give specific, actionable notes. ${TAGS_NOTE} ${JSON_ONLY}
Shape: {"pass": boolean, "evidence": string, "notes": string}`,
  prompt(i: CheckInput): string {
    const deps = i.dependencies.length
      ? `\n\nEARLIER APPROVED STEPS (context only):\n${i.dependencies.map((d) => deliverable(d.idx, d.title, d.artifact)).join("\n\n")}`
      : "";
    return `${specBlock(i.spec)}${deps}\n\nSTEP ${i.step.idx}: ${i.step.title}\n${i.step.detail}\n\nSTEP CHECK:\n${i.step.check}\n\nARTIFACT TO CHECK:\n${deliverable(i.step.idx, i.step.title, i.artifact)}`;
  },
};

export const finalCheck = {
  system: `You are the independent checker doing the final sign-off. Judge each acceptance check against the delivered work and independent evidence only. Then write a short plain-language summary for the person: what was delivered, how to use it, and anything they still need to do themselves. ${TAGS_NOTE} ${JSON_ONLY}
Shape: {"results": [{"check": string, "pass": boolean, "evidence": string}], "summary": string}`,
  prompt(spec: Spec, steps: { idx: number; title: string; artifact: string }[], userSteps: string[]): string {
    return `${specBlock(spec)}\n\nDELIVERED WORK:\n${steps.map((s) => deliverable(s.idx, s.title, s.artifact)).join("\n\n")}${
      userSteps.length ? `\n\nSTEPS THE PERSON CONFIRMED THEY HANDLE THEMSELVES:\n${userSteps.map((s) => `- ${s}`).join("\n")}` : ""
    }`;
  },
};
