const MD5_MIN_CHUNK = 100;

const GRADE_NORMALIZE: Record<string, string> = {
  '1 bac': '1Ã¨re annÃ©e Bac', '1bac': '1Ã¨re annÃ©e Bac', '1ere bac': '1Ã¨re annÃ©e Bac',
  '1Ã¨re bac': '1Ã¨re annÃ©e Bac', 'premiere bac': '1Ã¨re annÃ©e Bac', '1st bac': '1Ã¨re annÃ©e Bac',
  '2 bac': '2Ã¨me annÃ©e Bac', '2bac': '2Ã¨me annÃ©e Bac', '2eme bac': '2Ã¨me annÃ©e Bac',
  '2Ã¨me bac': '2Ã¨me annÃ©e Bac', 'deuxieme bac': '2Ã¨me annÃ©e Bac', '2nd bac': '2Ã¨me annÃ©e Bac',
  'tcs': 'Tronc Commun', 'tc': 'Tronc Commun', 'tronc commun': 'Tronc Commun',
};

const SUBJECT_NORMALIZE: Record<string, string> = {
  'math': 'MathÃ©matiques', 'maths': 'MathÃ©matiques', 'mathÃ©matiques': 'MathÃ©matiques', 'mathematiques': 'MathÃ©matiques',
  'svt': 'Sciences de la Vie et de la Terre (SVT)', 'sciences de la vie': 'Sciences de la Vie et de la Terre (SVT)', 'biologie': 'Sciences de la Vie et de la Terre (SVT)',
  'physique': 'Physique-Chimie', 'physique-chimie': 'Physique-Chimie', 'pc': 'Physique-Chimie', 'physics': 'Physique-Chimie',
  'franÃ§ais': 'Langue FranÃ§aise', 'francais': 'Langue FranÃ§aise', 'french': 'Langue FranÃ§aise', 'langue franÃ§aise': 'Langue FranÃ§aise', 'fr': 'Langue FranÃ§aise',
  'arabe': 'Ø§Ù„Ù„ØºØ© Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©', 'arabic': 'Ø§Ù„Ù„ØºØ© Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©', 'arab': 'Ø§Ù„Ù„ØºØ© Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©',
  'anglais': 'English', 'english': 'English', 'ang': 'English',
  'islam': 'Ø§Ù„ØªØ±Ø¨ÙŠØ© Ø§Ù„Ø¥Ø³Ù„Ø§Ù…ÙŠØ©', 'islamique': 'Ø§Ù„ØªØ±Ø¨ÙŠØ© Ø§Ù„Ø¥Ø³Ù„Ø§Ù…ÙŠØ©', 'education islamique': 'Ø§Ù„ØªØ±Ø¨ÙŠØ© Ø§Ù„Ø¥Ø³Ù„Ø§Ù…ÙŠØ©',
  'histoire': 'Ø§Ù„Ø§Ø¬ØªÙ…Ø§Ø¹ÙŠØ§Øª', 'gÃ©ographie': 'Ø§Ù„Ø§Ø¬ØªÙ…Ø§Ø¹ÙŠØ§Øª', 'hist-geo': 'Ø§Ù„Ø§Ø¬ØªÙ…Ø§Ø¹ÙŠØ§Øª', 'histoire-gÃ©ographie': 'Ø§Ù„Ø§Ø¬ØªÙ…Ø§Ø¹ÙŠØ§Øª',
  'philosophie': 'Ø§Ù„ÙÙ„Ø³ÙØ©', 'philo': 'Ø§Ù„ÙÙ„Ø³ÙØ©',
  'informatique': "Sciences de l'IngÃ©nieur", 'si': "Sciences de l'IngÃ©nieur", 'sciences de l\'ingÃ©nieur': "Sciences de l'IngÃ©nieur",
  'Ã©conomie': 'Ã‰conomie GÃ©nÃ©rale et Statistique', 'eco': 'Ã‰conomie GÃ©nÃ©rale et Statistique',
  'comptabilitÃ©': 'ComptabilitÃ© et MathÃ©matiques FinanciÃ¨res', 'compta': 'ComptabilitÃ© et MathÃ©matiques FinanciÃ¨res',
  'eoae': 'Ã‰conomie et Organisation Administrative des Entreprises (EOAE)',
};

export const md5Browser = (str: string): string => {
  function safeAdd(x: number, y: number) { const lsw = (x & 0xffff) + (y & 0xffff); return (((x >> 16) + (y >> 16) + (lsw >> 16)) << 16) | (lsw & 0xffff); }
  function bitRotateLeft(num: number, cnt: number) { return (num << cnt) | (num >>> (32 - cnt)); }
  function md5cmn(q: number, a: number, b: number, x: number, s: number, t: number) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function md5ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
  function md5gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function md5hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
  function md5ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }
  function md5blks(s: string) {
    const nblk = ((s.length + 8) >> 6) + 1; const blks = new Array(nblk * 16).fill(0);
    for (let i = 0; i < s.length; i++) blks[i >> 2] |= s.charCodeAt(i) << ((i % 4) * 8);
    blks[s.length >> 2] |= 0x80 << ((s.length % 4) * 8);
    blks[nblk * 16 - 2] = s.length * 8; return blks;
  }
  const x = md5blks(str);
  let [a, b, c, d] = [1732584193, -271733879, -1732584194, 271733878];
  for (let i = 0; i < x.length; i += 16) {
    const [oa, ob, oc, od] = [a, b, c, d];
    a=md5ff(a,b,c,d,x[i+0],7,-680876936);d=md5ff(d,a,b,c,x[i+1],12,-389564586);c=md5ff(c,d,a,b,x[i+2],17,606105819);b=md5ff(b,c,d,a,x[i+3],22,-1044525330);
    a=md5ff(a,b,c,d,x[i+4],7,-176418897);d=md5ff(d,a,b,c,x[i+5],12,1200080426);c=md5ff(c,d,a,b,x[i+6],17,-1473231341);b=md5ff(b,c,d,a,x[i+7],22,-45705983);
    a=md5ff(a,b,c,d,x[i+8],7,1770035416);d=md5ff(d,a,b,c,x[i+9],12,-1958414417);c=md5ff(c,d,a,b,x[i+10],17,-42063);b=md5ff(b,c,d,a,x[i+11],22,-1990404162);
    a=md5ff(a,b,c,d,x[i+12],7,1804603682);d=md5ff(d,a,b,c,x[i+13],12,-40341101);c=md5ff(c,d,a,b,x[i+14],17,-1502002290);b=md5ff(b,c,d,a,x[i+15],22,1236535329);
    a=md5gg(a,b,c,d,x[i+1],5,-165796510);d=md5gg(d,a,b,c,x[i+6],9,-1069501632);c=md5gg(c,d,a,b,x[i+11],14,643717713);b=md5gg(b,c,d,a,x[i+0],20,-373897302);
    a=md5gg(a,b,c,d,x[i+5],5,-701558691);d=md5gg(d,a,b,c,x[i+10],9,38016083);c=md5gg(c,d,a,b,x[i+15],14,-660478335);b=md5gg(b,c,d,a,x[i+4],20,-405537848);
    a=md5gg(a,b,c,d,x[i+9],5,568446438);d=md5gg(d,a,b,c,x[i+14],9,-1019803690);c=md5gg(c,d,a,b,x[i+3],14,-187363961);b=md5gg(b,c,d,a,x[i+8],20,1163531501);
    a=md5gg(a,b,c,d,x[i+13],5,-1444681467);d=md5gg(d,a,b,c,x[i+2],9,-51403784);c=md5gg(c,d,a,b,x[i+7],14,1735328473);b=md5gg(b,c,d,a,x[i+12],20,-1926607734);
    a=md5hh(a,b,c,d,x[i+5],4,-378558);d=md5hh(d,a,b,c,x[i+8],11,-2022574463);c=md5hh(c,d,a,b,x[i+11],16,1839030562);b=md5hh(b,c,d,a,x[i+14],23,-35309556);
    a=md5hh(a,b,c,d,x[i+1],4,-1530992060);d=md5hh(d,a,b,c,x[i+4],11,1272893353);c=md5hh(c,d,a,b,x[i+7],16,-155497632);b=md5hh(b,c,d,a,x[i+10],23,-1094730640);
    a=md5hh(a,b,c,d,x[i+13],4,681279174);d=md5hh(d,a,b,c,x[i+0],11,-358537222);c=md5hh(c,d,a,b,x[i+3],16,-722521979);b=md5hh(b,c,d,a,x[i+6],23,76029189);
    a=md5hh(a,b,c,d,x[i+9],4,-640364487);d=md5hh(d,a,b,c,x[i+12],11,-421815835);c=md5hh(c,d,a,b,x[i+15],16,530742520);b=md5hh(b,c,d,a,x[i+2],23,-995338651);
    a=md5ii(a,b,c,d,x[i+0],6,-198630844);d=md5ii(d,a,b,c,x[i+7],10,1126891415);c=md5ii(c,d,a,b,x[i+14],15,-1416354905);b=md5ii(b,c,d,a,x[i+5],21,-57434055);
    a=md5ii(a,b,c,d,x[i+12],6,1700485571);d=md5ii(d,a,b,c,x[i+3],10,-1894986606);c=md5ii(c,d,a,b,x[i+10],15,-1051523);b=md5ii(b,c,d,a,x[i+1],21,-2054922799);
    a=md5ii(a,b,c,d,x[i+8],6,1873313359);d=md5ii(d,a,b,c,x[i+15],10,-30611744);c=md5ii(c,d,a,b,x[i+6],15,-1560198380);b=md5ii(b,c,d,a,x[i+13],21,1309151649);
    a=md5ii(a,b,c,d,x[i+4],6,-145523070);d=md5ii(d,a,b,c,x[i+11],10,-1120210379);c=md5ii(c,d,a,b,x[i+2],15,718787259);b=md5ii(b,c,d,a,x[i+9],21,-343485551);
    a=safeAdd(a,oa);b=safeAdd(b,ob);c=safeAdd(c,oc);d=safeAdd(d,od);
  }
  return [a,b,c,d].map(n => (n < 0 ? n + 0x100000000 : n).toString(16).padStart(8,'0')).join('');
};

export const normalizeClassification = (grade: string | null, subject: string | null) => {
  const g = grade?.toLowerCase().trim();
  const s = subject?.toLowerCase().trim();
  return {
    grade:   (g && GRADE_NORMALIZE[g])   || grade,
    subject: (s && SUBJECT_NORMALIZE[s]) || subject,
  };
};

export const parseJsonObject = <T,>(rawResponse: string): T => {
  const cleaned = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const candidate = firstBrace >= 0 && lastBrace > firstBrace
    ? cleaned.slice(firstBrace, lastBrace + 1)
    : cleaned;
  return JSON.parse(candidate) as T;
};

export const isAllowedChoice = (value: string | null, choices: string[]) => {
  if (!value) return false;
  if (choices.length === 0) return true;
  const normalized = value.toLowerCase().trim();
  return choices.some(choice => choice.toLowerCase().trim() === normalized);
};

export const buildClassificationPrompt = (
  fileName: string,
  snippet: string,
  grades: string[],
  subjects: string[],
) => `Analyze this Moroccan curriculum file.
Filename: "${fileName}"
Text snippet: "${snippet}"

Choose exactly one grade and one subject from the allowed lists below.
Allowed grades: [${grades.join(', ')}]
Allowed subjects: [${subjects.join(', ')}]

Rules:
- Prefer the filename when it clearly states the level or stream.
- Use the text snippet to break ties.
- Return null only if the value is truly absent from the allowed list.
- Output only valid JSON with this exact schema: {"grade":"allowed value or null","subject":"allowed value or null"}.`;

const splitOversizedSegment = (segment: string, size: number, overlap: number) => {
  const pieces: string[] = [];
  let remaining = segment.trim();

  while (remaining.length > size) {
    const window = remaining.slice(0, size);
    const boundaryCandidates = [
      window.lastIndexOf('\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf('! '),
      window.lastIndexOf('? '),
      window.lastIndexOf('; '),
      window.lastIndexOf(': '),
      window.lastIndexOf('ØŒ '),
      window.lastIndexOf(' ')
    ];
    const cutIndex = Math.max(...boundaryCandidates.filter(idx => idx >= Math.floor(size * 0.55)));
    const safeCut = cutIndex > 0 ? cutIndex + 1 : size;
    const piece = remaining.slice(0, safeCut).trim();

    if (piece.length >= MD5_MIN_CHUNK) {
      pieces.push(piece);
    }

    const resumeFrom = Math.max(0, safeCut - overlap);
    remaining = remaining.slice(resumeFrom).trim();
  }

  if (remaining.length >= MD5_MIN_CHUNK) {
    pieces.push(remaining);
  }

  return pieces;
};

export const splitIntoChunks = (text: string, size: number = 1200, overlap: number = 200) => {
  const normalized = text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return [];

  const chunks: string[] = [];
  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const flushChunk = (value: string) => {
    const cleaned = value.trim();
    if (cleaned.length >= MD5_MIN_CHUNK) {
      chunks.push(cleaned);
    }
  };

  let current = '';

  const appendUnit = (unit: string) => {
    if (!unit) return;

    if (unit.length > size) {
      if (current) {
        flushChunk(current);
        current = '';
      }
      splitOversizedSegment(unit, size, overlap).forEach(piece => flushChunk(piece));
      return;
    }

    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (candidate.length <= size) {
      current = candidate;
      return;
    }

    flushChunk(current);
    const tail = current.slice(Math.max(0, current.length - overlap)).trim();
    current = tail ? `${tail}\n\n${unit}` : unit;

    if (current.length > size) {
      splitOversizedSegment(current, size, overlap).forEach(piece => flushChunk(piece));
      current = '';
    }
  };

  for (const paragraph of paragraphs) {
    const sentences = paragraph
      .split(/(?<=[.!?;:])\s+|(?<=\u061f)\s+/)
      .map(sentence => sentence.trim())
      .filter(Boolean);

    if (sentences.length <= 1) {
      appendUnit(paragraph);
      continue;
    }

    let paragraphGroup = '';
    for (const sentence of sentences) {
      const candidate = paragraphGroup ? `${paragraphGroup} ${sentence}` : sentence;
      if (candidate.length <= size) {
        paragraphGroup = candidate;
      } else {
        appendUnit(paragraphGroup);
        paragraphGroup = sentence;
      }
    }
    appendUnit(paragraphGroup);
  }

  if (current) {
    flushChunk(current);
  }

  return chunks;
};
