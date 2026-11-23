import type { GameStateResponse } from '../types/chessmind';

export type ChessPieceCode = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface PieceGuide {
  title: string;
  howMoves: string;
  howCaptures: string;
  tip: string;
}

export const PIECE_GUIDES: Record<ChessPieceCode, PieceGuide> = {
  p: {
    title: 'Пішак',
    howMoves: 'Ходить тільки вперед на 1 клітинку (а з початкової лінії може піти одразу на 2).',
    howCaptures: 'Бʼє по діагоналі вперед на 1 клітинку (не прямо!).',
    tip: 'Дійшовши до краю дошки, пішак перетворюється на сильнішу фігуру (зазвичай ферзя).',
  },
  n: {
    title: 'Кінь',
    howMoves: 'Ходить літерою «Г»: 2 клітинки в один бік і 1 вбік. Єдина фігура, яка перестрибує інші!',
    howCaptures: 'Бʼє фігуру суперника, якщо стає на її клітинку кінцем свого ходу.',
    tip: 'Тримайте коней ближче до центру — там у них найбільше клітинок для атаки.',
  },
  b: {
    title: 'Слон',
    howMoves: 'Ковзає по діагоналях на будь-яку вільну відстань (не перестрибує фігури).',
    howCaptures: 'Бʼє першу фігуру суперника на своєму діагональному шляху.',
    tip: 'Один слон завжди ходить лише по світлих полях, інший — лише по темних.',
  },
  r: {
    title: 'Тура',
    howMoves: 'Рухається по прямих лініях — вперед, назад або вбік на будь-яку кількість вільних клітинок.',
    howCaptures: 'Бʼє фігуру суперника, стаючи на її клітинку вздовж прямої лінії.',
    tip: 'Може робити рокіровку разом із королем, щоб сховати короля в безпечне місце.',
  },
  q: {
    title: 'Ферзь',
    howMoves: 'Найсильніша фігура: ходить і по прямих, і по діагоналях на будь-яку відстань.',
    howCaptures: 'Бʼє будь-яку доступну фігуру суперника на прямій або діагоналі.',
    tip: 'Не виводьте ферзя занадто рано на початку гри — легкі фігури суперника можуть його атакувати.',
  },
  k: {
    title: 'Король',
    howMoves: 'Ходить на 1 клітинку в будь-якому напрямку (окрім рокіровки — тоді на 2 клітинки до тури).',
    howCaptures: 'Може побити незахищену фігуру суперника поруч, якщо це не ставить короля під удар.',
    tip: 'Головне завдання — берегти короля. Коли короля атакують (шах), його потрібно негайно захистити.',
  },
};

export interface SelectedPieceInfo {
  square: string;
  type: ChessPieceCode;
  color: 'w' | 'b';
  legalCount: number;
  captureCount: number;
}

export function getBeginnerInteractiveHint(
  game: GameStateResponse | null,
  selectedPiece: SelectedPieceInfo | null,
): { title: string; body: string } | null {
  if (!game || game.level !== 'beginner' || game.status !== 'active') return null;

  if (game.is_check) {
    return {
      title: 'Увага: Шах вашому королю!',
      body: 'Король під атакою. Зараз дозволені лише ті ходи, які рятують короля: відійдіть ним, перекрийте удар або побийте нападника.',
    };
  }

  if (selectedPiece) {
    const guide = PIECE_GUIDES[selectedPiece.type];
    const captureText =
      selectedPiece.captureCount > 0
        ? ` Червоні кільця (${selectedPiece.captureCount}) показують, кого можна побити зараз!`
        : '';
    return {
      title: `${guide.title} · поле ${selectedPiece.square.toUpperCase()}`,
      body: `${guide.howMoves} ${guide.howCaptures}${captureText}`,
    };
  }

  const playerMoves = game.moves.filter((m) => m.color === game.player_color).length;

  if (playerMoves === 0) {
    return {
      title: 'Перший крок у партії',
      body: 'Натисніть на будь-яку свою фігуру на 3D-дошці. Зелені крапки покажуть куди можна походити, а червоні кільця — кого можна побити.',
    };
  }

  if (playerMoves === 1) {
    return {
      title: 'Розвиток фігур',
      body: 'Чудово! Спробуйте вивести конів або слонів ближче до центру дошки (поля e4, d4, e5, d5), щоб контролювати більше простору.',
    };
  }

  if (playerMoves === 2 || playerMoves === 3) {
    return {
      title: 'Захист і безпека',
      body: 'Перед кожним ходом перевіряйте, чи не залишаєте ви свою фігуру без захисту. Намагайтесь зробити рокіровку, щоб сховати короля.',
    };
  }

  return null;
}
