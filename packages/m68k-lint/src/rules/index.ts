import type { Rule } from "../core/rule.js";
import { nullBranch } from "./optimization/null-branch.js";
import { preferAddq } from "./optimization/prefer-addq.js";
import { preferMoveq } from "./optimization/prefer-moveq.js";
import { redundantLea } from "./optimization/redundant-lea.js";
import { preferSubq } from "./optimization/prefer-subq.js";
import {
  preferSubqForNegativeAdd,
  preferAddqForNegativeSub,
} from "./optimization/quick-negative.js";
import { preferNot } from "./optimization/prefer-not.js";
import { preferTstZero } from "./optimization/prefer-tst-zero.js";
import { preferBset, preferBclr } from "./optimization/prefer-bit-op.js";
import { shiftToClear } from "./optimization/shift-to-clear.js";
import { selfMove } from "./suspicious/self-move.js";
import { suspiciousNop } from "./suspicious/nop.js";
import { staleConditionCode } from "./suspicious/stale-condition-code.js";
import { zeroSizedStorage } from "./suspicious/zero-sized-storage.js";
import { conditionAfterPreservedCcr } from "./suspicious/condition-after-preserved-ccr.js";
import { moveaWordSignExtension } from "./suspicious/movea-word-sign-extension.js";
import { bitNumberWraparound } from "./suspicious/bit-number-wraparound.js";
import { partialRegisterWrite } from "./suspicious/partial-register-write.js";
import { unexpectedAbsoluteAddress } from "./suspicious/unexpected-absolute-address.js";
import {
  requireInstructionSize,
  omitRedundantInstructionSize,
} from "./style/instruction-size-style.js";
import {
  preferAddressRegisterMnemonics,
  preferDbraAlias,
  preferDbfAlias,
  preferUnsignedConditionAliases,
  preferCarryConditionAliases,
} from "./style/semantic-mnemonic-style.js";
import { preferLeaQuick } from "./optimization/prefer-lea-quick.js";
import { jsrRtsTailCall, bsrRtsTailCall } from "./optimization/tail-call.js";
import { pushAddressPea } from "./optimization/push-address-pea.js";
import { preferMoveqZero } from "./optimization/prefer-moveq-zero.js";
import { preferStMinusOne } from "./optimization/prefer-st-minus-one.js";
import { preferAddForShiftOne } from "./optimization/prefer-add-for-shift-one.js";
import { preferMoveWordAddress } from "./optimization/prefer-move-word-address.js";
import { zeroAddressRegister } from "./optimization/zero-address-register.js";
import { preferUnlkSequence } from "./optimization/prefer-unlk-sequence.js";
import { preferLinkSequence } from "./optimization/prefer-link-sequence.js";
import { btstSignBranch } from "./optimization/btst-sign-branch.js";
import {
  combineAdjacentClrBytes,
  combineAdjacentClrWords,
} from "./optimization/adjacent-clear.js";
import {
  combineAdjacentMoveBytes,
  combineAdjacentMoveWords,
} from "./optimization/adjacent-immediate-move.js";
import {
  combineAdjacentCopyBytes,
  combineAdjacentCopyWords,
} from "./optimization/adjacent-copy.js";
import { redundantZeroDisplacement } from "./optimization/redundant-zero-displacement.js";
import {
  addressAddToLea,
  addressSubToLea,
} from "./optimization/address-immediate-lea.js";
import { pushImmediatePea } from "./optimization/push-immediate-pea.js";
import { singleRegisterMovem } from "./optimization/single-register-movem.js";
import {
  bsetLowWordMask,
  bclrLowWordMask,
  bchgLowWordMask,
} from "./optimization/bit-op-low-word.js";
import { shiftTwoAdds } from "./optimization/shift-two-adds.js";
import { addsToShift } from "./optimization/adds-to-shift.js";

import { knownZeroClear } from "./optimization/known-zero-clear.js";
import { zeroStoreToClear } from "./optimization/zero-store-to-clear.js";
import { moveImmediateViaScratch } from "./optimization/move-immediate-via-scratch.js";
import { cmpZeroAddressViaScratch } from "./optimization/cmp-zero-address-via-scratch.js";
import { combineConsecutiveAddq } from "./optimization/combine-consecutive-addq.js";
import { combineAddressAdjustments } from "./optimization/combine-address-adjustments.js";
import { combineConsecutiveShift } from "./optimization/combine-consecutive-shift.js";
import { combineConsecutiveBitOps } from "./optimization/combine-consecutive-bit-ops.js";
import { combineLoadsIntoMovem } from "./optimization/combine-loads-into-movem.js";
import {
  multiplyWordByZero,
  multiplySignedWordByOne,
  multiplyUnsignedWordByOne,
  multiplySignedWordPowerOfTwo,
  multiplyUnsignedWordPowerOfTwo,
  multiplySignedWordHighPowerOfTwo,
  multiplyUnsignedWordHighPowerOfTwo,
} from "./optimization/multiply-simple.js";
import {
  negateThenSubToAdd,
  negateThenAddToSub,
  negateAddMaskToEor,
} from "./optimization/negate-arithmetic-pair.js";
import {
  moveImmediateBelowMoveq,
  moveImmediateByteComplement,
  moveImmediateDoubleByte,
} from "./optimization/move-immediate-synthesis.js";
import { cancelAddqPredecrementMove } from "./optimization/cancel-addq-predecrement-move.js";
import { cancelSubqPostincrementMove } from "./optimization/cancel-subq-postincrement-move.js";
import { zeroArithmeticToTst } from "./optimization/zero-arithmetic-to-tst.js";
import { combineExtByte } from "./optimization/combine-ext-byte.js";

import { redundantTst } from "./optimization/redundant-tst.js";
import { bsetToTas } from "./optimization/bset-to-tas.js";
import { leaZeroAddress } from "./optimization/lea-zero-address.js";
import {
  moveImmediateWordComplement,
  moveImmediateSwap,
} from "./optimization/move-immediate-word-synthesis.js";
import { longShiftSequence } from "./optimization/long-shift-sequence.js";
import {
  moveImmediateAddressToLea,
  moveAddressThenAddToLea,
} from "./optimization/movea-lea.js";
import { atariTrapStackCleanup } from "./suspicious/atari/trap-stack-cleanup.js";
import { amigaBitMaskConstants } from "./correctness/amiga/bit-mask-constant.js";
import { movemRestoreMismatch } from "./suspicious/movem-restore-mismatch.js";
import { unusedLocalLabel } from "./suspicious/unused-local-label.js";
import { unusedGlobalLabel } from "./suspicious/unused-global-label.js";
import { unusedConstant } from "./suspicious/unused-constant.js";
import { unusedMacro } from "./suspicious/unused-macro.js";
import { stringEscapeSequence } from "./suspicious/string-escape-sequence.js";
import { includeCase } from "./portability/include-case.js";
import { unreachableCode } from "./suspicious/unreachable-code.js";
import { infiniteLoop } from "./suspicious/infinite-loop.js";
import { dbraWordCounter } from "./suspicious/dbra-word-counter.js";
import { missingEven } from "./suspicious/missing-even.js";
import { oddAddressAccess } from "./suspicious/odd-address-access.js";
import { unbalancedStack } from "./suspicious/unbalanced-stack.js";
import { unusedComparison } from "./suspicious/unused-comparison.js";
import { constantCondition } from "./suspicious/constant-condition.js";
import { unneededRegisterSave } from "./optimization/unneeded-register-save.js";
import { maskViaMoveq } from "./optimization/mask-via-moveq.js";
import { carryToMaskViaSubx } from "./optimization/carry-to-mask-via-subx.js";
import { arithmeticImmediateViaScratch } from "./optimization/arithmetic-immediate-via-scratch.js";
import { deadRegisterWrite } from "./suspicious/dead-register-write.js";
import { dataRegisterSignBitToTas } from "./optimization/data-register-sign-bit-to-tas.js";
import { foldIndexIntoEffectiveAddress } from "./optimization/fold-index-into-effective-address.js";
import { foldRedundantIntermediate } from "./optimization/fold-redundant-intermediate.js";
import { cancelMultiplePredecrementMoves } from "./optimization/cancel-multiple-predecrement-moves.js";
import { cancelStackPeaSequence } from "./optimization/cancel-stack-pea-sequence.js";
import { multiplyLongByOne } from "./optimization/multiply-long-by-one.js";
import {
  multiplyLongSmallConstant,
  multiplyLongLargePowerOfTwo,
  multiplySignedLong060,
} from "./optimization/multiply-long-constants.js";
import { cmpaZeroToTst030 } from "./optimization/cmpa-zero-to-tst-030.js";
import { multiplySignedWordSelectedConstants } from "./optimization/muls-word-selected-constants.js";
import { foldAddressExpressionToLea } from "./optimization/address-expression-to-lea.js";
import {
  divuWordPowerOfTwo,
  divuLongPowerOfTwo,
} from "./optimization/divu-power-of-two.js";
import { divuWordByConstant } from "./optimization/divu-word-by-constant.js";
import {
  divsWordPowerOfTwo,
  divsWordByConstant,
} from "./optimization/divs-word-recipes.js";
import {
  narrowMoveaImmediate,
  narrowAddaSubaImmediate,
  narrowCmpaImmediate,
} from "./optimization/narrow-address-immediates.js";
import { simplifyLongWordMasks } from "./optimization/simplify-long-word-mask.js";
import { normalizeByteRotate } from "./optimization/normalize-byte-rotate-direction.js";
import {
  simplifyKnownRegisterRotate,
  roxlToAddx,
  lslByteSeven,
  aslByteSeven,
} from "./optimization/rotate-sequences.js";
import {
  knownRegisterShiftToClear,
  lsrByteSeven,
  asrByteSaturate,
  knownRegisterShiftReduction,
  knownRegisterAsrWordLowOnly,
  knownRegisterAsrLongHighReduction,
  knownRegisterAsrSaturate,
} from "./optimization/known-register-shifts.js";
import { foldAddressArithmeticToIndexedLea } from "./optimization/address-arithmetic-indexed-lea.js";
import {
  flamewingMulsWordFullResultConstants,
  flamewingMulsWordLowWordOnly,
  flamewingMuluWordLowWordOnly,
} from "./optimization/multiply-word-recipes.js";
import { moveByteAndMaskViaMoveq } from "./optimization/move-byte-and-mask.js";
import {
  andAllOnesToTst,
  orZeroToTst,
  eorZeroToTst,
} from "./optimization/logical-identity-to-tst.js";
import { compareLongImmediateViaMoveq } from "./optimization/compare-long-immediate-via-moveq.js";
import { destructiveSmallCompareBranch } from "./optimization/destructive-small-compare-branch.js";
import { jsrJmpDispatch } from "./optimization/jsr-jmp-tail-dispatch.js";
import {
  stackAlignedWordShiftByEight,
  stackAlignedKnownRegisterShifts,
} from "./optimization/stack-scratch-shifts.js";
import { vasmNegativeSignedMultiply } from "./optimization/negative-signed-multiply.js";
import { amigaTasUnsupported } from "./correctness/amiga/tas-unsupported.js";
import { amigaCustomRegisterAccess } from "./correctness/amiga/custom-register-access.js";

export {
  amigaTasUnsupported,
  amigaCustomRegisterAccess,
  vasmNegativeSignedMultiply,
  stackAlignedWordShiftByEight,
  stackAlignedKnownRegisterShifts,
  nullBranch,
  preferAddq,
  preferMoveq,
  redundantLea,
  preferSubq,
  preferSubqForNegativeAdd,
  preferAddqForNegativeSub,
  preferNot,
  preferTstZero,
  preferBset,
  preferBclr,
  shiftToClear,
  selfMove,
  suspiciousNop,
  staleConditionCode,
  zeroSizedStorage,
  conditionAfterPreservedCcr,
  moveaWordSignExtension,
  bitNumberWraparound,
  partialRegisterWrite,
  unexpectedAbsoluteAddress,
  atariTrapStackCleanup,
  amigaBitMaskConstants,
  movemRestoreMismatch,
  unusedLocalLabel,
  unusedGlobalLabel,
  unusedConstant,
  unusedMacro,
  stringEscapeSequence,
  includeCase,
  unreachableCode,
  infiniteLoop,
  dbraWordCounter,
  missingEven,
  oddAddressAccess,
  unbalancedStack,
  unusedComparison,
  constantCondition,
  unneededRegisterSave,
  maskViaMoveq,
  carryToMaskViaSubx,
  arithmeticImmediateViaScratch,
  deadRegisterWrite,
  dataRegisterSignBitToTas,
  foldIndexIntoEffectiveAddress,
  foldRedundantIntermediate,
  compareLongImmediateViaMoveq,
  destructiveSmallCompareBranch,
  jsrJmpDispatch,
  moveByteAndMaskViaMoveq,
  requireInstructionSize,
  omitRedundantInstructionSize,
  preferAddressRegisterMnemonics,
  preferDbraAlias,
  preferDbfAlias,
  preferUnsignedConditionAliases,
  preferCarryConditionAliases,
  preferLeaQuick,
  jsrRtsTailCall,
  bsrRtsTailCall,
  pushAddressPea,
  preferMoveqZero,
  preferStMinusOne,
  preferAddForShiftOne,
  preferMoveWordAddress,
  zeroAddressRegister,
  preferUnlkSequence,
  preferLinkSequence,
  btstSignBranch,
  combineAdjacentClrBytes,
  combineAdjacentClrWords,
  combineAdjacentMoveBytes,
  combineAdjacentMoveWords,
  combineAdjacentCopyBytes,
  combineAdjacentCopyWords,
  redundantZeroDisplacement,
  addressAddToLea,
  addressSubToLea,
  pushImmediatePea,
  singleRegisterMovem,
  bsetLowWordMask,
  bclrLowWordMask,
  bchgLowWordMask,
  shiftTwoAdds,
  addsToShift,
  knownZeroClear,
  zeroStoreToClear,
  moveImmediateViaScratch,
  cmpZeroAddressViaScratch,
  combineConsecutiveAddq,
  combineAddressAdjustments,
  combineConsecutiveShift,
  combineConsecutiveBitOps,
  combineLoadsIntoMovem,
  multiplyWordByZero,
  multiplySignedWordByOne,
  multiplyUnsignedWordByOne,
  multiplySignedWordPowerOfTwo,
  multiplyUnsignedWordPowerOfTwo,
  multiplySignedWordHighPowerOfTwo,
  multiplyUnsignedWordHighPowerOfTwo,
  negateThenSubToAdd,
  negateThenAddToSub,
  negateAddMaskToEor,
  moveImmediateBelowMoveq,
  moveImmediateByteComplement,
  moveImmediateDoubleByte,
  moveImmediateWordComplement,
  moveImmediateSwap,
  cancelAddqPredecrementMove,
  cancelSubqPostincrementMove,
  zeroArithmeticToTst,
  combineExtByte,
  redundantTst,
  bsetToTas,
  leaZeroAddress,
  longShiftSequence,
  moveImmediateAddressToLea,
  moveAddressThenAddToLea,
  cancelMultiplePredecrementMoves,
  cancelStackPeaSequence,
  multiplyLongByOne,
  multiplyLongSmallConstant,
  multiplyLongLargePowerOfTwo,
  multiplySignedLong060,
  cmpaZeroToTst030,
  multiplySignedWordSelectedConstants,
  foldAddressExpressionToLea,
  divuWordPowerOfTwo,
  divuWordByConstant,
  divsWordPowerOfTwo,
  divsWordByConstant,
  divuLongPowerOfTwo,
  narrowMoveaImmediate,
  narrowAddaSubaImmediate,
  simplifyLongWordMasks,
  normalizeByteRotate,
  simplifyKnownRegisterRotate,
  roxlToAddx,
  lslByteSeven,
  aslByteSeven,
  knownRegisterShiftToClear,
  lsrByteSeven,
  asrByteSaturate,
  knownRegisterShiftReduction,
  knownRegisterAsrWordLowOnly,
  knownRegisterAsrLongHighReduction,
  knownRegisterAsrSaturate,
  foldAddressArithmeticToIndexedLea,
  flamewingMulsWordFullResultConstants,
  flamewingMulsWordLowWordOnly,
  flamewingMuluWordLowWordOnly,
  narrowCmpaImmediate,
  andAllOnesToTst,
  orZeroToTst,
  eorZeroToTst,
};

export const defaultRules: readonly Rule[] = [
  preferCarryConditionAliases,
  preferUnsignedConditionAliases,
  preferDbfAlias,
  preferDbraAlias,
  preferAddressRegisterMnemonics,
  requireInstructionSize,
  omitRedundantInstructionSize,
  amigaTasUnsupported,
  amigaCustomRegisterAccess,
  vasmNegativeSignedMultiply,
  stackAlignedKnownRegisterShifts,
  stackAlignedWordShiftByEight,
  compareLongImmediateViaMoveq,
  destructiveSmallCompareBranch,
  jsrJmpDispatch,
  andAllOnesToTst,
  orZeroToTst,
  eorZeroToTst,
  narrowCmpaImmediate,
  moveByteAndMaskViaMoveq,
  narrowMoveaImmediate,
  narrowAddaSubaImmediate,
  simplifyLongWordMasks,
  normalizeByteRotate,
  simplifyKnownRegisterRotate,
  roxlToAddx,
  lslByteSeven,
  aslByteSeven,
  knownRegisterShiftToClear,
  lsrByteSeven,
  asrByteSaturate,
  knownRegisterShiftReduction,
  knownRegisterAsrWordLowOnly,
  knownRegisterAsrLongHighReduction,
  knownRegisterAsrSaturate,
  foldAddressArithmeticToIndexedLea,
  flamewingMulsWordFullResultConstants,
  flamewingMulsWordLowWordOnly,
  flamewingMuluWordLowWordOnly,
  divuLongPowerOfTwo,
  foldAddressExpressionToLea,
  divuWordPowerOfTwo,
  divuWordByConstant,
  divsWordPowerOfTwo,
  divsWordByConstant,
  multiplySignedWordSelectedConstants,
  cmpaZeroToTst030,
  multiplySignedLong060,
  multiplyLongLargePowerOfTwo,
  multiplyLongSmallConstant,
  cancelStackPeaSequence,
  multiplyLongByOne,
  redundantTst,
  bsetToTas,
  leaZeroAddress,
  longShiftSequence,
  moveImmediateAddressToLea,
  moveAddressThenAddToLea,
  cancelMultiplePredecrementMoves,
  moveImmediateWordComplement,
  moveImmediateSwap,
  combineExtByte,
  zeroArithmeticToTst,
  cancelAddqPredecrementMove,
  cancelSubqPostincrementMove,
  moveImmediateBelowMoveq,
  moveImmediateByteComplement,
  moveImmediateDoubleByte,
  negateAddMaskToEor,
  negateThenSubToAdd,
  negateThenAddToSub,
  multiplyUnsignedWordPowerOfTwo,
  multiplySignedWordHighPowerOfTwo,
  multiplyUnsignedWordHighPowerOfTwo,
  multiplyWordByZero,
  multiplySignedWordByOne,
  multiplyUnsignedWordByOne,
  multiplySignedWordPowerOfTwo,
  knownZeroClear,
  zeroStoreToClear,
  cmpZeroAddressViaScratch,
  combineConsecutiveAddq,
  combineAddressAdjustments,
  combineConsecutiveShift,
  combineConsecutiveBitOps,
  combineLoadsIntoMovem,
  moveImmediateViaScratch,
  redundantZeroDisplacement,
  addressAddToLea,
  addressSubToLea,
  pushImmediatePea,
  singleRegisterMovem,
  bsetLowWordMask,
  bclrLowWordMask,
  bchgLowWordMask,
  shiftTwoAdds,
  addsToShift,
  preferMoveq,
  preferMoveqZero,
  preferMoveWordAddress,
  zeroAddressRegister,
  preferAddq,
  preferSubq,
  preferSubqForNegativeAdd,
  preferAddqForNegativeSub,
  preferNot,
  preferStMinusOne,
  preferAddForShiftOne,
  preferTstZero,
  btstSignBranch,
  preferBset,
  preferBclr,
  shiftToClear,
  preferLeaQuick,
  pushAddressPea,
  preferLinkSequence,
  preferUnlkSequence,
  combineAdjacentClrBytes,
  combineAdjacentClrWords,
  combineAdjacentMoveBytes,
  combineAdjacentMoveWords,
  combineAdjacentCopyBytes,
  combineAdjacentCopyWords,
  jsrRtsTailCall,
  bsrRtsTailCall,
  redundantLea,
  nullBranch,
  zeroSizedStorage,
  conditionAfterPreservedCcr,
  moveaWordSignExtension,
  bitNumberWraparound,
  partialRegisterWrite,
  unexpectedAbsoluteAddress,
  atariTrapStackCleanup,
  amigaBitMaskConstants,
  movemRestoreMismatch,
  unusedLocalLabel,
  unusedGlobalLabel,
  unusedConstant,
  unusedMacro,
  stringEscapeSequence,
  includeCase,
  unreachableCode,
  infiniteLoop,
  dbraWordCounter,
  missingEven,
  oddAddressAccess,
  unbalancedStack,
  unusedComparison,
  constantCondition,
  unneededRegisterSave,
  maskViaMoveq,
  carryToMaskViaSubx,
  arithmeticImmediateViaScratch,
  deadRegisterWrite,
  dataRegisterSignBitToTas,
  foldIndexIntoEffectiveAddress,
  foldRedundantIntermediate,
  selfMove,
  suspiciousNop,
  staleConditionCode,
];
