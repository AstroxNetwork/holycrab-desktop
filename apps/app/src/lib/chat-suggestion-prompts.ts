const JSON_RENDER_SKILL_PROMPT = [
  'You are a JSON Render layout generator for HolyCrab Chat.',
  'Generate only one valid JSON object that can be rendered by json-render.',
  'Do not output markdown, code fences, explanations, or extra text.',
  'Use only components from this catalog:',
  '- Grid',
  '- Card',
  '- Text',
  '- Badge',
  '- Metric',
  '- StockItem',
  '- NewsItem',
  '- Button',
  '- KeyValue',
  '- Divider',
  'Hard constraints:',
  '- Root must be an object with "type": "Grid" and "items": [...].',
  '- Every node must use the shape: {"type":"ComponentName", ...props, "items":[...optional children...]}.',
  '- Use concise labels and realistic sample values.',
  '- Keep spacing readable and avoid over-nesting.',
  '- Prefer a compact dark dashboard style suitable for market monitoring.',
  '- Output must be a single JSON object only.',
  '- JSON must be strictly valid and fully parseable by JSON.parse (no trailing commas, no comments, no partial output).',
  '- If JSON is invalid, regenerate from scratch before responding.',
  '- Never use DSL/object-key style component notation (e.g. {"Grid": {...}}).',
  '- Never use mixed token arrays like ["Card", {...}]',
].join('\n')

const QUICK_MARKET_REQUIREMENTS = [
  'Build a Quick Market Insight dashboard for BTC and ETH.',
  'Include at least:',
  '1) top summary metrics (price, 24h change, volume),',
  '2) risk highlights,',
  '3) short actionable checklist for next 24h.',
  'Add market sentiment and one warning badge when volatility is high.',
].join('\n')

export function buildQuickMarketInsightPrompt(basePrompt: string) {
  const task = basePrompt.trim() || QUICK_MARKET_REQUIREMENTS
  const goodExample = JSON.stringify({
    type: 'Grid',
    columns: 2,
    gap: 16,
    items: [
      {
        type: 'Card',
        title: '市场快照',
        description: 'BTC / ETH 24h 概览',
        items: [
          { type: 'StockItem', symbol: 'BTC', price: '$94,230', change: '+2.3%', volume: '$87.2B' },
          { type: 'StockItem', symbol: 'ETH', price: '$3,612', change: '+1.8%', volume: '$18.4B' },
          { type: 'Metric', label: '市场情绪', value: '中性偏多' },
          { type: 'Badge', label: '风险预警: 波动性较高', tone: 'warning' },
        ],
      },
      {
        type: 'Card',
        title: '24h 行动清单',
        items: [
          { type: 'KeyValue', key: 'BTC策略', value: '$50k 分批止盈' },
          { type: 'KeyValue', key: 'ETH策略', value: '回踩支撑观察' },
          { type: 'KeyValue', key: '重点关注', value: '山寨轮动与资金迁移' },
        ],
      },
    ],
  })

  const badExamples = [
    '{"Grid":{"items":[...]}}  // bad: DSL object-key notation',
    '["Card", {"Title":"..."}]  // bad: mixed token array',
    '```json {"type":"Grid"} ```  // bad: markdown code fence',
    '{"type":"Grid"} extra words  // bad: extra text outside JSON',
  ].join('\n')

  return [
    '[Skill Prompt]',
    JSON_RENDER_SKILL_PROMPT,
    '',
    '[Task]',
    task,
    '',
    '[Extra Requirement]',
    QUICK_MARKET_REQUIREMENTS,
    '',
    '[Good Example]',
    goodExample,
    '',
    '[Bad Examples]',
    badExamples,
    '',
    '[Final Rule]',
    'Return only one JSON object. No markdown. No explanations.',
  ].join('\n')
}
