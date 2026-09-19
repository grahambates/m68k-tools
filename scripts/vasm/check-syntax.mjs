/**
 * Line syntax against vasm: where the operand field ends, what a comment is,
 * how labels, sizes and directives may be spelled.
 *
 * Each snippet is assembled by vasm and its size compared with what 68kcounter
 * (which reads the source through m68k-parser) makes of it. Where vasm gives an
 * error the snippet is not a valid program, and the report says whether the
 * parser at least noticed. A snippet is a line or two of source, indented as
 * written here.
 *
 * Run from the repository root after `pnpm build`.
 */
import { createRequire } from "node:module";
import { assemble, findVasm, inParallel, cleanUp } from "./vasm.mjs";

const require = createRequire(import.meta.url);
const parse = require("../../packages/68kcounter").default;
const { parseFile } = require("../../packages/m68k-parser");

const vasm = findVasm();
if (!vasm) {
  console.log("vasm not found (set VASM): skipping the syntax check");
  process.exit(0);
}

const T = "\t";
const cases = [
  // Whitespace and where the operands end. In this syntax a blank ends them, so
  // what follows is a comment.
  `${T}move.w d0,d1`,
  `${T}move.w d0,d1 ; comment`,
  `${T}move.w d0,d1 comment without a marker`,
  `${T}move.w d0, d1`,
  `${T}move.w d0 ,d1`,
  `${T}move.w d0,d1${T}${T}comment after tabs`,
  `${T}move.w  d0,d1`,
  `${T}move.w${T}d0,d1`,
  ` move.w d0,d1`,
  `    move.w    d0,d1`,
  `${T}dc.b 1, 2`,
  `${T}dc.b 1,2 ,3`,
  `${T}dc.b 1,2,3`,
  `${T}dc.b "a b",0`,
  `${T}dc.b "a b", 0`,
  `${T}dc.b 'a b',0`,
  `${T}dc.w 1 , 2`,
  `${T}dc.l 1+2,3`,
  `${T}dc.l 1 + 2,3`,
  `${T}dc.l 1+ 2,3`,
  `${T}move.l #1 + 2,d0`,
  `${T}move.l #1+2,d0`,
  `${T}move.l (a0, d0.w),d1`,
  `${T}move.l 4(a0, d0.w),d1`,
  `${T}move.l (4, a0),d1`,
  `${T}move.l ( a0 ),d1`,
  `${T}lea 4( a0 ),a1`,

  // Comments.
  `; a comment`,
  `* a comment`,
  `${T}* not at the start`,
  `${T}; indented`,
  `${T}nop ; trailing`,
  `${T}nop * trailing star`,
  `${T}nop text`,
  `${T}nop${T}text`,
  `${T}dc.b "a;b",0`,
  `${T}dc.b ';',0`,
  `${T}dc.b "a*b",0`,
  `${T}rts ; c1 ; c2`,
  ``,
  `   `,

  // Labels.
  `lbl: nop`,
  `lbl nop`,
  `lbl:`,
  `lbl`,
  `lbl:${T}nop`,
  `lbl${T}nop`,
  `lbl::${T}nop`,
  `.local: nop`,
  `.local nop`,
  `local$: nop`,
  `lbl:${T}move.w d0,d1 comment`,
  `_lbl: nop`,
  `l1b: nop`,
  `LBL: nop`,
  `lbl:nop`,
  `lbl:dc.w 1`,
  `lbl: dc.w 1`,
  `lbl dc.w 1`,
  `lbl dc.w 1,2`,
  `${T}nop`,
  `nop`,
  `NOP`,
  `${T}NOP`,

  // Mnemonics, sizes and their spelling.
  `${T}MOVE.W D0,D1`,
  `${T}Move.W D0,D1`,
  `${T}move.w D0,d1`,
  `${T}move.W d0,d1`,
  `${T}move d0,d1`,
  `${T}move.b d0,d1`,
  `${T}move.l d0,d1`,
  `${T}move.s d0,d1`,
  `${T}move.q d0,d1`,
  `${T}bra.s l`,
  `${T}bra.b l`,
  `${T}bra.w l`,
  `${T}bra l`,
  `${T}bra.l l`,
  `${T}dbra d0,l`,
  `${T}dbf d0,l`,
  `${T}dbt d0,l`,
  `${T}blo l`,
  `${T}bhs l`,
  `${T}bcc l`,
  `${T}bcs l`,
  `${T}beq l`,
  `${T}bze l`,
  `${T}bnz l`,
  `${T}jmp l`,
  `${T}jsr l`,
  `${T}bsr l`,
  `${T}bsr.s l`,
  `${T}addq #1,d0`,
  `${T}addq.l #1,d0`,
  `${T}add #1,d0`,
  `${T}add.w #1,d0`,
  `${T}sub #1,d0`,
  `${T}cmp #1,d0`,
  `${T}clr d0`,
  `${T}clr.l d0`,
  `${T}lsl d0,d1`,
  `${T}lsl #1,d1`,
  `${T}lsl d1`,
  `${T}lsl (a0)`,
  `${T}asl.w #1,d1`,
  `${T}swap d0`,
  `${T}ext d0`,
  `${T}ext.w d0`,
  `${T}ext.l d0`,
  `${T}exg d0,d1`,
  `${T}exg a0,d1`,
  `${T}tst d0`,
  `${T}tst.b (a0)`,
  `${T}movem.l d0-d3/a0-a2,-(sp)`,
  `${T}movem.l (sp)+,d0-d3/a0-a2`,
  `${T}movem d0-d1,-(sp)`,
  `${T}move.l sp,a0`,
  `${T}move.l a7,a0`,
  `${T}move.l SP,a0`,
  `${T}move.l usp,a0`,
  `${T}move.w sr,d0`,
  `${T}move.w d0,sr`,
  `${T}move.w d0,ccr`,
  `${T}move.b d0,ccr`,
  `${T}trap #0`,
  `${T}stop #$2700`,
  `${T}reset`,
  `${T}illegal`,
  `${T}nop`,
  `${T}rts`,
  `${T}rte`,
  `${T}rtr`,
  `${T}link a6,#-4`,
  `${T}unlk a6`,
  `${T}pea (a0)`,
  `${T}pea 4(a0)`,
  `${T}lea (a0),a1`,
  `${T}lea l(pc),a1`,
  `${T}lea (l,pc),a1`,
  `${T}move.w l(pc),d0`,
  `${T}move.w (l,pc,d0.w),d0`,
  `${T}move.w l(pc,d0.w),d0`,
  `${T}move.w 2(a0,d0),d1`,
  `${T}move.w 2(a0,d0.l),d1`,
  `${T}move.w (a0)+,(a1)+`,
  `${T}move.w -(a0),-(a1)`,
  `${T}move.w $1234.w,d0`,
  `${T}move.w $1234.l,d0`,
  `${T}move.w ($1234).w,d0`,
  `${T}move.w ($12345678).l,d0`,
  `${T}move.w $1234,d0`,
  `${T}move.l #$1234,d0`,
  `${T}move.l #%1010,d0`,
  `${T}move.l #@17,d0`,
  `${T}move.l #'a',d0`,

  // Directives.
  `${T}dc.b 1`,
  `${T}dc.w 1`,
  `${T}dc.l 1`,
  `${T}dc 1`,
  `${T}db 1`,
  `${T}dw 1`,
  `${T}dl 1`,
  `${T}DC.B 1`,
  `${T}.byte 1`,
  `${T}.word 1`,
  `${T}.long 1`,
  `${T}ds.b 4`,
  `${T}ds.w 4`,
  `${T}ds.l 4`,
  `${T}ds 4`,
  `${T}blk.b 4`,
  `${T}dcb.b 4,1`,
  `${T}dcb.w 4,1`,
  `${T}dcb.l 2,1`,
  `${T}dcb 2,1`,
  `${T}dc.s 1.5`,
  `${T}dc.d 1.5`,
  `${T}dc.x 1.5`,
  `${T}dc.p 1.5`,
  `${T}dc.q 1.5`,
  `${T}even`,
  `${T}dc.b 1${"\n"}${T}even`,
  `${T}dc.b 1${"\n"}${T}cnop 0,4`,
  `${T}dc.b 1${"\n"}${T}align 2`,
  `${T}dc.b 1${"\n"}${T}align 4`,
  `${T}dc.b 1${"\n"}${T}even${"\n"}${T}even`,
  `x${T}equ 4${"\n"}${T}dc.b x`,
  `x = 4${"\n"}${T}dc.b x`,
  `x${T}set 4${"\n"}${T}dc.b x`,
  `x${T}equ 4${"\n"}x${T}set 5`,
  `x equ 4`,
  `x  equ  4`,
  `${T}x equ 4`,
  `x${T}=${T}4`,
  `x=4`,
  `x =4`,
  `x= 4`,
  `x${T}rs.b 1`,
  `${T}rsreset${"\n"}x${T}rs.b 1${"\n"}y${T}rs.w 1${"\n"}${T}dc.b y`,
  `${T}rsset 4${"\n"}x${T}rs.l 1${"\n"}${T}dc.b x`,
  `d5r${T}equr d5${"\n"}${T}move.w d5r,d0`,
  `${T}section code,code`,
  `${T}section code${"\n"}${T}nop`,
  `${T}section code,code_c${"\n"}${T}nop`,
  `${T}section "code",code${"\n"}${T}nop`,
  `${T}org $1000${"\n"}${T}nop`,
  `${T}printt "hello"`,
  `${T}fail "x"`,
  `${T}echo "x"`,
  `${T}dc.b "abc"`,
  `${T}dc.b 'abc'`,
  `${T}dc.b "abc",0`,
  `${T}dc.b <abc>`,
  `${T}dc.b "a""b"`,
  `${T}dc.w "ab"`,
  `${T}dc.l "abcd"`,
  `${T}dc.b -1`,
  `${T}dc.b 255`,
  `${T}dc.b 256`,
  `${T}dc.w $ffff`,
  `${T}dc.w -1`,
  `${T}dc.b 1,2,3,`,
  `${T}dc.b ,1`,
  `${T}dc.b`,
  `${T}dc.w`,

  // Conditional assembly and macros around their arguments.
  `${T}ifne 1${"\n"}${T}nop${"\n"}${T}endc`,
  `${T}if 1${"\n"}${T}nop${"\n"}${T}endif`,
  `${T}ifeq 1${"\n"}${T}nop${"\n"}${T}endc`,
  `${T}if 1${"\n"}${T}nop${"\n"}${T}else${"\n"}${T}rts${"\n"}${T}endc`,
  `${T}if 0${"\n"}${T}nop${"\n"}${T}else${"\n"}${T}rts${"\n"}${T}endc`,
  `${T}ifd x${"\n"}${T}nop${"\n"}${T}endc`,
  `x = 1${"\n"}${T}ifd x${"\n"}${T}nop${"\n"}${T}endc`,
  `x = 1${"\n"}${T}ifnd x${"\n"}${T}nop${"\n"}${T}endc`,
  `${T}iif 1 nop`,
  `${T}iif 0 nop`,
  `m${T}macro${"\n"}${T}nop${"\n"}${T}endm${"\n"}${T}m`,
  `${T}macro m${"\n"}${T}nop${"\n"}${T}endm${"\n"}${T}m`,
  `m: macro${"\n"}${T}nop${"\n"}${T}endm${"\n"}${T}m`,
  `m${T}macro${"\n"}${T}move.w \\1,d0${"\n"}${T}endm${"\n"}${T}m d1`,
  `m${T}macro${"\n"}${T}move.w \\1,\\2${"\n"}${T}endm${"\n"}${T}m d1,d2`,
  `m${T}macro${"\n"}${T}move.w \\1,\\2${"\n"}${T}endm${"\n"}${T}m d1, d2`,
  `m${T}macro${"\n"}${T}dc.b narg${"\n"}${T}endm${"\n"}${T}m a,b,c`,
  `m${T}macro${"\n"}${T}dc.b \\@${"\n"}${T}endm${"\n"}${T}m`,
  `${T}rept 3${"\n"}${T}nop${"\n"}${T}endr`,
  `${T}rept 0${"\n"}${T}nop${"\n"}${T}endr`,
];

const results = await inParallel(cases, async (text) => {
  const source = text.replace(/\bl$|\bl\b(?=\W|$)/g, "l") + "\nl:\n";
  const { bytes, messages } = await assemble(vasm, `${source}\n`);
  return { text, source, bytes, messages };
});

function ours(source) {
  let file;
  try {
    file = parseFile(source);
  } catch (e) {
    return { error: String(e) };
  }
  let total = 0;
  try {
    total = parse(source).reduce((sum, line) => sum + (line.bytes ?? 0), 0);
  } catch (e) {
    return { error: String(e) };
  }
  return { bytes: total, errors: file.errors.length };
}

/**
 * Differences that are understood and left as they are, each with its reason.
 * Anything not matched here fails the check, so a new one is noticed.
 */
const known = [
  [
    /^[\w]*\t(dc\.[bwl]|dc) .*[ ] ?[,+]|,\d* ,|\d [,+] /,
    "a blank before a comma or operator: vasm ends the operands there, the parser reads on so a project assembled with -spaces or -phxass still reads",
  ],
  [
    /\t(even|cnop|align)\b/,
    "68kcounter does not track position, so it adds no alignment padding",
  ],
  [/\bequr\b/, "68kcounter does not know register aliases made with EQUR"],
  [
    /\b(macro|rept|endm|endr)\b/,
    "68kcounter annotates a macro or repeat body where it is written, for reference, so adding up every line counts it twice; its totals do not",
  ],
  [
    /\t(if|ifne|ifeq|ifd|ifnd|iif)\b|\b(ifnd|ifd) /,
    "68kcounter does not evaluate conditional assembly",
  ],
];
const reasonFor = (text) => known.find(([pattern]) => pattern.test(text))?.[1];

const differ = [];
const explained = [];
const disagree = [];
for (const r of results) {
  const o = ours(r.source);
  if (r.bytes) {
    if (o.error || o.bytes !== r.bytes.length || o.errors) {
      const entry = { ...r, ours: o, vasmBytes: r.bytes.length };
      (reasonFor(r.text) ? explained : differ).push(entry);
    }
  } else if (o.errors === 0 && !o.error) {
    disagree.push({ ...r, ours: o });
  }
}

const show = (t) => JSON.stringify(t.replace(/\t/g, "⇥"));
console.log(
  `${results.length} snippets: ${results.length - differ.length - explained.length - disagree.length} agree; ${differ.length} differ; ${explained.length} differ for a known reason; ${disagree.length} rejected by vasm and accepted by the parser`,
);
for (const r of differ)
  console.log(
    `  differs ${show(r.text)}: vasm ${r.vasmBytes} bytes, ours ${r.ours.error ?? `${r.ours.bytes} bytes${r.ours.errors ? `, ${r.ours.errors} parse error(s)` : ""}`}`,
  );
if (process.argv.includes("--known"))
  for (const r of explained)
    console.log(`  known ${show(r.text)}: ${reasonFor(r.text)}`);
if (process.argv.includes("--rejected"))
  for (const r of disagree)
    console.log(
      `  rejected ${show(r.text)}: ${r.messages
        .trim()
        .split("\n")[0]
        .replace(/ in line \d+ of "[^"]*"/, "")}`,
    );

await cleanUp();
process.exitCode = differ.length ? 1 : 0;
