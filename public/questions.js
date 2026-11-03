// W&W Wiki 题库视图：列表 / 新建 / 编辑。
// 原则：不虚构历史答案；模板仅生成“上下文观察”类草稿；批准须填写 reviewed_by；
// 记录修订变化后，已审定题目标记“需复核”，并会被游戏导出排除。

const EVIDENCE_KINDS = [
  ['image_observation', '图像观察'],
  ['user_clarification', '用户澄清'],
  ['source', '外部出处'],
];

export async function renderQuestions(params, helpers) {
  const { view, el, api, tag, field, setNavCurrent, questionStateTags, isStale, token } = helpers;
  setNavCurrent('questions');

  let records = [];
  try {
    const data = await api('/api/records');
    if (isStale(token)) return;
    records = data.records;
  } catch (err) {
    if (isStale(token)) return;
    view.replaceChildren(
      el('h1', { class: 'page-title', text: '题库加载失败' }),
      el('p', { class: 'page-sub', text: err.message }),
    );
    return;
  }

  const recordLabel = (id) => {
    const rec = records.find((r) => r.id === id);
    return rec ? `${rec.title}（${rec.id}）` : id;
  };

  // ---------- 筛选 ----------
  const statusSel = el('select', { id: 'q-f-status' }, [
    el('option', { value: '', text: '全部状态' }),
    el('option', { value: 'draft', text: '草稿' }),
    el('option', { value: 'approved', text: '已审定' }),
  ]);
  statusSel.value = params.get('status') || '';
  const recordSel = el('select', { id: 'q-f-record' }, [
    el('option', { value: '', text: '全部记录' }),
    ...records.map((r) => el('option', { value: r.id, text: `${r.title}（${r.id}）` })),
  ]);
  recordSel.value = params.get('record_id') || '';
  const countSpan = el('span', { class: 'result-count', text: '' });
  const listBox = el('div', { class: 'question-list' });

  // ---------- 编辑 / 新建表单 ----------
  const fRecord = el('select', { id: 'q-record' },
    records.map((r) => el('option', { value: r.id, text: `${r.title}（${r.id}）` })));
  const fPrompt = el('textarea', { id: 'q-prompt', placeholder: '题干：仅就档案图像所见、用户澄清或注明出处的信息提问' });
  const fOptions = el('textarea', { id: 'q-options', placeholder: '每行一个选项，2–6 个，不重复' });
  const fCorrect = el('input', { type: 'text', id: 'q-correct', value: '0', inputmode: 'numeric' });
  const fExplanation = el('textarea', { id: 'q-explanation', placeholder: '为什么这是正确答案；仅限图像可见内容、用户澄清或注明出处' });
  const fEvidenceNote = el('textarea', { id: 'q-evidence-note', placeholder: '证据说明：指向具体记录、图像区域或用户澄清内容' });
  const fEvidenceKind = el('select', { id: 'q-evidence-kind' },
    EVIDENCE_KINDS.map(([v, label]) => el('option', { value: v, text: label })));
  const fStatus = el('select', { id: 'q-status' }, [
    el('option', { value: 'draft', text: '草稿 draft' }),
    el('option', { value: 'approved', text: '已审定 approved' }),
  ]);
  const fReviewedBy = el('input', { type: 'text', id: 'q-reviewed-by', placeholder: '审定人（批准时必填）' });
  const fVersions = el('input', { type: 'text', id: 'q-game-versions', placeholder: '采用此题的游戏版本，以逗号分隔；未采用则留空' });

  const formTitle = el('h2', { text: '新建题目' });
  const formMsg = el('span', { class: 'form-msg', role: 'status' });
  const submitBtn = el('button', { class: 'btn', type: 'button', text: '保存题目' });
  const cancelBtn = el('button', { class: 'btn btn-quiet', type: 'button', text: '取消' });
  let editingId = null;

  // 模板只生成上下文观察类草稿：不含任何预设历史答案。
  const templateBtn = el('button', { class: 'btn btn-quiet', type: 'button', text: '填入观察模板（草稿）' });
  templateBtn.addEventListener('click', () => {
    const rid = fRecord.value;
    fPrompt.value = `在档案 ${rid} 的参考图像中，……（仅就图中所见提问，勿推广为历史结论）`;
    fOptions.value = '（根据图像观察填写正确选项）\n（干扰项一）\n（干扰项二）';
    fCorrect.value = '0';
    fExplanation.value = '（说明判断依据，仅限图像可见内容或用户澄清；不得引入未注明出处的历史断言。）';
    fEvidenceNote.value = `基于 ${rid} 的图像观察 / 用户澄清，非外部文献。`;
    fEvidenceKind.value = 'image_observation';
    fStatus.value = 'draft';
    fReviewedBy.value = '';
  });

  const formPanel = el('div', { class: 'panel question-form', style: 'display:none' }, [
    formTitle,
    field('关联档案记录', fRecord),
    field('题干', fPrompt),
    field('选项（每行一个，2–6 个）', fOptions),
    field('正确选项序号（0 起）', fCorrect),
    field('解析', fExplanation),
    field('证据说明', fEvidenceNote),
    field('证据类型', fEvidenceKind),
    field('状态', fStatus),
    field('审定人 reviewed_by', fReviewedBy),
    field('游戏采用版本', fVersions),
    el('p', { class: 'hint', text: '证据类型：图像观察 = 仅描述图中可见；用户澄清 = 案例提供者的补充说明；外部出处 = 须在来源网址中给出可核验链接。批准（approved）必须填写审定人。' }),
    el('div', { class: 'form-actions' }, [submitBtn, templateBtn, cancelBtn, formMsg]),
  ]);

  function openForm(question) {
    editingId = question ? question.id : null;
    formTitle.textContent = question ? `编辑题目 ${question.id}` : '新建题目';
    fRecord.value = question ? question.record_id : (recordSel.value || records[0]?.id || '');
    fPrompt.value = question ? question.prompt : '';
    fOptions.value = question ? question.options.join('\n') : '';
    fCorrect.value = question ? String(question.correct_index) : '0';
    fExplanation.value = question ? question.explanation : '';
    fEvidenceNote.value = question ? question.evidence_note : '';
    fEvidenceKind.value = question ? question.evidence_kind : 'image_observation';
    fStatus.value = question ? question.status : 'draft';
    fReviewedBy.value = question?.reviewed_by || '';
    fVersions.value = (question?.game_versions || []).join(', ');
    formMsg.className = 'form-msg';
    formMsg.textContent = '';
    formPanel.style.display = '';
    formPanel.scrollIntoView({ block: 'start' });
  }

  cancelBtn.addEventListener('click', () => {
    formPanel.style.display = 'none';
    editingId = null;
  });

  submitBtn.addEventListener('click', async () => {
    formMsg.className = 'form-msg';
    const options = fOptions.value.split('\n').map((s) => s.trim()).filter(Boolean);
    const payload = {
      record_id: fRecord.value,
      prompt: fPrompt.value,
      options,
      correct_index: Number(fCorrect.value),
      explanation: fExplanation.value,
      evidence_note: fEvidenceNote.value,
      evidence_kind: fEvidenceKind.value,
      status: fStatus.value,
      reviewed_by: fReviewedBy.value,
      game_versions: fVersions.value.split(/[,，]/).map(v=>v.trim()).filter(Boolean),
    };
    submitBtn.disabled = true;
    formMsg.textContent = '保存中…';
    try {
      if (editingId) {
        await api(`/api/questions/${encodeURIComponent(editingId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await api('/api/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      formMsg.classList.add('ok');
      formMsg.textContent = '已保存。';
      editingId = null;
      formPanel.style.display = 'none';
      await load();
    } catch (err) {
      formMsg.classList.add('err');
      formMsg.textContent = `保存失败：${err.message}`;
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ---------- 列表 ----------
  async function load() {
    const query = new URLSearchParams();
    if (statusSel.value) query.set('status', statusSel.value);
    if (recordSel.value) query.set('record_id', recordSel.value);
    let data;
    try {
      data = await api(`/api/questions?${query}`);
    } catch (err) {
      if (isStale(token)) return;
      listBox.replaceChildren(el('div', { class: 'empty-state', text: `题目加载失败：${err.message}` }));
      return;
    }
    if (isStale(token)) return;
    countSpan.textContent = `共 ${data.count} 题`;
    listBox.replaceChildren();
    if (data.questions.length === 0) {
      listBox.append(el('div', { class: 'empty-state', text: '暂无匹配题目。可新建；题目仅基于图像观察、用户澄清或注明出处。' }));
      return;
    }
    for (const q of data.questions) {
      const editBtn = el('button', { class: 'btn btn-quiet', type: 'button', text: '编辑' });
      editBtn.addEventListener('click', () => openForm(q));
      const card = el('div', { class: 'question-card' }, [
        el('div', { class: 'q-head' }, [
          el('p', { class: 'q-prompt', text: q.prompt }),
          el('div', { class: 'q-tags' }, [
            el('span', { class: 'mono', text: q.id }),
            ...questionStateTags(q),
            ...(q.game_versions || []).map(v => tag('游戏采用 · '+v)),
            tag(EVIDENCE_KINDS.find(([v]) => v === q.evidence_kind)?.[1] || q.evidence_kind),
          ]),
        ]),
        el('ol', { class: 'q-options', start: '0' },
          q.options.map((opt, i) => el('li', i === q.correct_index
            ? { class: 'correct', text: `${opt}（正确答案）` }
            : { text: opt }))),
        el('dl', { class: 'meta' }, [
          el('dt', { text: '关联记录' }),
          el('dd', {}, [el('a', { href: `#/record/${encodeURIComponent(q.record_id)}`, text: recordLabel(q.record_id) })]),
          el('dt', { text: '解析' }), el('dd', { text: q.explanation }),
          el('dt', { text: '证据说明' }), el('dd', { text: q.evidence_note }),
          el('dt', { text: '审定' }),
          el('dd', { text: q.status === 'approved'
            ? `${q.reviewed_by || '（缺审定人）'} · ${q.reviewed_at || ''}`
            : '未审定（草稿不会进入游戏导出）' }),
          ...(q.needs_review
            ? [el('dt', { text: '复核' }), el('dd', { text: '关联记录已修改，此题基于旧修订，需复核并重新审定后才会进入游戏导出。' })]
            : []),
        ]),
        el('div', { class: 'form-actions' }, [editBtn]),
      ]);
      listBox.append(card);
    }
  }

  const applyBtn = el('button', { class: 'btn', type: 'button', text: '筛选' });
  applyBtn.addEventListener('click', load);
  statusSel.addEventListener('change', load);
  recordSel.addEventListener('change', load);

  const newBtn = el('button', { class: 'btn', type: 'button', text: '新建题目' });
  newBtn.addEventListener('click', () => openForm(null));

  view.replaceChildren(
    el('h1', { class: 'page-title', text: '题库' }),
    el('p', { class: 'page-sub' }, [
      '游戏问答题库。不虚构历史答案：题目只能基于图像观察、用户澄清或注明出处。草稿与“需复核”的题目不会进入游戏导出。 ',
      el('a', { href: '/api/game-export', download: '', text: '导出游戏题库' }),
    ]),
    el('div', { class: 'toolbar' }, [
      el('div', { class: 'field' }, [el('label', { for: 'q-f-status', text: '状态' }), statusSel]),
      el('div', { class: 'field grow' }, [el('label', { for: 'q-f-record', text: '关联记录' }), recordSel]),
      applyBtn,
      newBtn,
      countSpan,
    ]),
    formPanel,
    listBox,
  );

  if (params.get('new') === '1') openForm(null);
  await load();
}
