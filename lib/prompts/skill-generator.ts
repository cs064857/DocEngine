/**
 * Skill Generator Prompt 模板
 *
 * 三步 Agent 流程：Summarize（摘要） → Generate（生成骨架）→ Refine（精修）。
 * 每個 Prompt 使用佔位符 {{...}} 供運行時填充。
 */

/**
 * 第一步：文檔摘要
 * 輸入：所有 cleaned MD 文件的名稱與內容片段
 * 輸出：結構化的主題摘要、建議 skill name / description
 */
export const SUMMARIZE_DOCS_PROMPT = `You are a technical documentation analyst. Your job is to analyze a collection of Markdown documents and produce a structured summary.

## Input Documents

The user has provided the following documentation files:

{{fileList}}

## Document Contents

{{documentContents}}

## Instructions

1. **Analyze** all the documents above and identify:
   - The primary technology/library/framework being documented
   - Key concepts, APIs, and features covered
   - The overall scope and depth of the documentation

2. **Output** a JSON block with exactly this structure:

\`\`\`json
{
  "suggestedName": "skill-name-in-kebab-case",
  "suggestedDescription": "A concise, actionable description of what this skill enables. Include specific trigger phrases and contexts. Make it slightly pushy to ensure the skill triggers when relevant.",
  "primaryTechnology": "Name of the main tech/library",
  "topics": ["topic1", "topic2", "topic3"],
  "summary": "A 2-4 paragraph summary of what these documents cover, including key APIs, patterns, and use cases.",
  "keyFeatures": ["feature1", "feature2"],
  "fileGrouping": {
    "core": ["files that cover core concepts"],
    "api": ["files covering API reference"],
    "guides": ["tutorial/guide files"],
    "other": ["misc files"]
  }
}
\`\`\`

Be specific and thorough. The summary will be used to generate a comprehensive skill document.`;


/**
 * 第二步：生成 SKILL.md
 * 輸入：第一步的摘要 + 完整文件列表
 * 輸出：符合 Antigravity 格式的 SKILL.md 完整內容
 */
export const GENERATE_SKILL_PROMPT = `You are an expert at creating Antigravity/OpenCode skill documents. Generate a complete SKILL.md file based on the analysis below.

## Documentation Analysis

{{summary}}

## Reference Files Available

The following reference files will be available in the \`references/\` directory alongside SKILL.md:

{{fileList}}

## SKILL.md Format Requirements

The SKILL.md MUST follow this exact format:

1. **YAML Frontmatter** (required):
\`\`\`yaml
---
name: skill-name-in-kebab-case
description: >
  Comprehensive description of what this skill does and when to use it.
  Include specific trigger phrases. Be slightly "pushy" to ensure the skill
  triggers appropriately. Example: "Make sure to use this skill whenever
  the user asks about X, Y, or Z, even if they don't explicitly mention it."
---
\`\`\`

2. **Markdown Body** with these sections:
   - **Title** (# heading matching the skill name)
   - **Overview**: What this skill enables, when to use it
   - **Key Concepts**: Core concepts from the documentation
   - **API Reference / Usage Guide**: The most important APIs, patterns, or workflows
   - **Examples**: Practical code examples drawn from the documentation
   - **Reference Files**: A section listing the reference files and what each covers
   - **Best Practices**: Common patterns, gotchas, and recommendations
   - **Troubleshooting**: Common issues and solutions (if applicable)

3. **Critical Rules**:
   - Reference files using relative paths: \`references/filename.md\`
   - Include actionable instructions, not just descriptions
   - Use code blocks with language tags for examples
   - The description in frontmatter should be "pushy" — list all possible trigger phrases
   - Keep the skill focused and practical

## Output

Generate the complete SKILL.md content. Start with the YAML frontmatter \`---\` and end with the last line of content. Do not wrap in code blocks.`;


/**
 * 第三步：精修與校驗
 * 輸入：初版 SKILL.md + 文件列表
 * 輸出：修正後的最終版 SKILL.md
 */
export const REFINE_SKILL_PROMPT = `You are a quality reviewer for Antigravity skill documents. Review and refine the following SKILL.md draft.

## Current SKILL.md Draft

{{skillDraft}}

## Reference Files

{{fileList}}

## Review Checklist

1. **YAML Frontmatter**:
   - ✅ Has \`name\` (kebab-case, descriptive)
   - ✅ Has \`description\` (comprehensive, includes trigger phrases, slightly "pushy")
   - ❌ No extra fields that aren't \`name\` or \`description\`

2. **Content Quality**:
   - ✅ Has a clear # title
   - ✅ Overview explains WHEN to use this skill
   - ✅ Key concepts are accurately described
   - ✅ Code examples are correct and have language tags
   - ✅ Reference files are mentioned with correct relative paths (\`references/filename.md\`)
   - ✅ Best practices are actionable, not generic

3. **Completeness**:
   - ✅ All reference files are mentioned somewhere in the body
   - ✅ Description covers all reasonable trigger scenarios
   - ✅ No placeholder text or TODOs remain

4. **Formatting**:
   - ✅ Proper Markdown heading hierarchy (single #, then ##, ###)
   - ✅ Code blocks use appropriate language identifiers
   - ✅ Lists are consistent

## Instructions

Fix any issues found in the review. Output the complete, corrected SKILL.md. Do not explain your changes — just output the final document. Start with \`---\` (YAML frontmatter) and end with the last line of content.`;


/**
 * 替換 Prompt 模板中的佔位符
 */
export function fillPromptTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}
