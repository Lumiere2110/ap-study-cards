'use strict';

/**
 * Anki 方式（SM-2 ベース）の間隔反復スケジューラ。
 * rating: 1=もう一度 2=難しい 3=正解 4=簡単
 */
const SRS = (() => {
  const LEARN_STEPS = [1, 10];   // 新規カードの学習ステップ（分）
  const RELEARN_STEPS = [10];    // 間違えたカードの再学習ステップ（分）
  const GRADUATING_IVL = 1;      // 学習完了時の間隔（日）
  const EASY_IVL = 4;            // 新規で「簡単」を押した時の間隔（日）
  const START_EASE = 2.5;
  const MIN_EASE = 1.3;
  const EASY_BONUS = 1.3;
  const HARD_MULT = 1.2;
  const LAPSE_MULT = 0.5;
  const MAX_IVL = 3650;

  const RATINGS = [
    { value: 1, label: 'もう一度', key: '1', cls: 'again' },
    { value: 2, label: '難しい', key: '2', cls: 'hard' },
    { value: 3, label: '正解', key: '3', cls: 'good' },
    { value: 4, label: '簡単', key: '4', cls: 'easy' },
  ];

  function initial() {
    return { state: 'new', due: 0, interval: 0, ease: START_EASE, step: 0, reps: 0, lapses: 0 };
  }

  const isLearning = srs => srs.state === 'learning' || srs.state === 'relearning';

  function graduate(s, days, now) {
    s.state = 'review';
    s.step = 0;
    s.interval = Math.min(MAX_IVL, Math.max(1, Math.round(days)));
    s.due = studyDayStart(now) + s.interval * DAY;
  }

  /** 回答後の新しい srs 状態を返す（元のオブジェクトは変更しない） */
  function answer(srs, rating, now = Date.now()) {
    const s = { ...srs, reps: srs.reps + 1 };
    if (s.state === 'new') {
      s.state = 'learning';
      s.step = 0;
    }

    if (isLearning(s)) {
      const steps = s.state === 'learning' ? LEARN_STEPS : RELEARN_STEPS;
      const step = Math.min(s.step, steps.length - 1);
      if (rating === 1) {
        s.step = 0;
        s.due = now + steps[0] * MINUTE;
      } else if (rating === 2) {
        const next = steps[step + 1];
        const delay = step === 0 && next ? (steps[0] + next) / 2 : steps[step];
        s.due = now + delay * MINUTE;
      } else if (rating === 3) {
        if (step + 1 < steps.length) {
          s.step = step + 1;
          s.due = now + steps[s.step] * MINUTE;
        } else {
          graduate(s, s.state === 'learning' ? GRADUATING_IVL : s.interval, now);
        }
      } else {
        graduate(s, s.state === 'learning' ? EASY_IVL : s.interval + 1, now);
      }
      return s;
    }

    // 復習カード
    const ivl = Math.max(1, s.interval);
    const hard = Math.max(ivl + 1, ivl * HARD_MULT);
    const good = Math.max(hard + 1, ivl * s.ease);
    const easy = Math.max(good + 1, ivl * s.ease * EASY_BONUS);
    if (rating === 1) {
      s.lapses++;
      s.ease = Math.max(MIN_EASE, s.ease - 0.2);
      s.interval = Math.max(1, Math.round(ivl * LAPSE_MULT));
      s.state = 'relearning';
      s.step = 0;
      s.due = now + RELEARN_STEPS[0] * MINUTE;
    } else if (rating === 2) {
      s.ease = Math.max(MIN_EASE, s.ease - 0.15);
      graduate(s, hard, now);
    } else if (rating === 3) {
      graduate(s, good, now);
    } else {
      s.ease += 0.15;
      graduate(s, easy, now);
    }
    return s;
  }

  /** 各ボタンを押した場合の次回までの時間（表示用） */
  function preview(srs, now = Date.now()) {
    return RATINGS.map(r => {
      const s = answer(srs, r.value, now);
      return formatDuration(s.state === 'review' ? s.interval * DAY : s.due - now);
    });
  }

  function isDue(srs, now = Date.now()) {
    return srs.state !== 'new' && srs.due <= now;
  }

  return { RATINGS, initial, answer, preview, isDue, isLearning };
})();
