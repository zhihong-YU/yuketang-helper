// npm install jsdom@26; node --test ykt-helper.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, 'yuketang-helper.user.js'), 'utf8');
const apiNames = 'normalizeConfig,IdMap,StorageManager,repo,ui,actions,DEFAULT_CONFIG,makeChatUrl,applyProfileForm,withProfileTemperature,chatCompletion,imageDataUrl,parseAIAnswer,parseEditedAnswer,validateAnswer,canAutoSubmit,submitAnswer,bootCurrentRuntime,installXHRInterceptor,mountSettingsPanel,mountAIPanel,setAnswerEditor,handleAutoAnswerInternal,dispatchRealtimeMessage,createEventReminder,createScreenWakeLock,mdToHtml,loadScriptOnce,downloadPresentationPDF,downloadPresentation,getSiteHeaders,submissionDiagnostics,saveManualAnswer,cancelManualAnswer,tickManualAutoSubmit,loadManualAnswers,canSubmitManualAnswer,getNativeProblemContext,generatePreparedAI,queueAutomaticAI,answerAIJobs,noteAnswerEdit,answerEdits,AI_PROVIDER_PRESETS,createAIProfile,queryProblemText,queryAIVision,queryOCRVision';
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, { pathname = '/v2/web/index', config, gm = true, main = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://pro.yuketang.cn' + pathname, runScripts: 'outside-only' });
  const w = dom.window, values = new Map(), calls = [], errors = [];
  const observers = [], NativeMutationObserver = w.MutationObserver;
  w.MutationObserver = class extends NativeMutationObserver { constructor(callback) { super(callback); observers.push(this); } };
  w.console = { log() {}, info() {}, warn() {}, debug() {}, error() {} };
  w.addEventListener('error', e => { errors.push(e.error); e.preventDefault(); });
  w.GM_addStyle = css => { const el = w.document.createElement('style'); el.textContent = css; w.document.head.appendChild(el); };
  w.GM_notification = () => {};
  w.GM_xmlhttpRequest = opt => { calls.push(opt); return { abort() { opt.onabort?.(); } }; };
  w.fetch = async () => ({ ok: true, clone: () => ({ json: async () => ({}) }), text: async () => '{}' });
  w.confirm = () => true;
  if (gm) {
    w.GM_getValue = (key, dv) => values.has(key) ? values.get(key) : dv;
    w.GM_setValue = (key, value) => values.set(key, value);
    w.GM_deleteValue = key => values.delete(key);
  }
  if (config !== undefined) w.localStorage.setItem('ykt-helper:config', JSON.stringify(config));
  w.document.querySelector('#app').__vue__ = { $store: { state: {}, watch: () => () => {} } };
  let code = source.replace('  (function main() {', `  window.__test = {${apiNames}};\n  (function main() {`);
  if (!main) code = code.slice(0, code.indexOf('  (function main() {')) + '\n})();';
  w.eval(code);
  t.after(async () => { await flush(); observers.forEach(observer => observer.disconnect()); w.close(); });
  return { w, api: w.__test, values, calls, errors };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('初始化：损坏的 ai/null 不导致崩溃', t => {
  const { api } = fixture(t, { config: { ai: null } });
  assert.equal(api.ui.config.ai.profiles.length, 1);
});
test('配置：深合并、旧根级 Profile 迁移、无共享默认引用', t => {
  const { api } = fixture(t);
  const cfg = api.normalizeConfig({ profiles: [{ id: 'a', apiKey: 'old', baseUrl: 'https://example.org/v1', model: 'm' }], activeProfileId: 'missing' });
  assert.equal(cfg.ai.profiles[0].apiKey, 'old');
  assert.equal(cfg.ai.activeProfileId, 'a');
  cfg.ai.endpoint = 'changed';
  assert.notEqual(api.normalizeConfig().ai.endpoint, 'changed');
});
test('配置：0 音量及 0 延迟完整保留，非法数值归一化', t => {
  const { api } = fixture(t);
  const cfg = api.normalizeConfig({ notifyVolume: 0, autoAnswerDelay: 0, autoAnswerRandomDelay: 0, maxPresentations: -2 });
  assert.equal(cfg.notifyVolume, 0); assert.equal(cfg.autoAnswerDelay, 0); assert.equal(cfg.autoAnswerRandomDelay, 0); assert.equal(cfg.maxPresentations, 1);
});
test('存储：迁移到 GM 存储且移除站点旧配置', t => {
  const { w, api, values } = fixture(t, { config: { ai: { kimiApiKey: 'legacy-secret' } } });
  assert.equal(values.get('ykt-helper:config').ai.profiles[0].apiKey, 'legacy-secret');
  assert.equal(w.localStorage.getItem('ykt-helper:config'), null);
  assert.equal(api.ui.config.ai.profiles[0].apiKey, 'legacy-secret');
});
test('存储：无 GM 存储的宿主仍可读写本地配置', t => {
  const { w, api } = fixture(t, { gm: false });
  api.ui.config.notifyVolume = 0; assert.equal(api.ui.saveConfig(), true);
  assert.equal(JSON.parse(w.localStorage.getItem('ykt-helper:config')).notifyVolume, 0);
});
test('ID：数字与字符串键一致，删除也一致', t => {
  const { api } = fixture(t); const map = new api.IdMap();
  map.set(123, 'x'); assert.equal(map.get('123'), 'x'); map.set('123', 'y'); assert.equal(map.size, 1); map.delete(123); assert.equal(map.size, 0);
});
test('URL：根路径及 v1 自动补齐；自定义完整路径保留', t => {
  const { api } = fixture(t);
  assert.equal(api.makeChatUrl({ baseUrl: 'https://example.org/v1/' }), 'https://example.org/v1/chat/completions');
  assert.equal(api.makeChatUrl({ baseUrl: 'http://localhost:8080' }), 'http://localhost:8080/v1/chat/completions');
  assert.equal(api.makeChatUrl({ baseUrl: 'https://example.org/custom?x=1' }), 'https://example.org/custom?x=1');
  assert.throws(() => api.makeChatUrl({ baseUrl: 'javascript:alert(1)' }));
});
test('Profile：非法温度不部分改写配置，可清空图像模型', t => {
  const { api } = fixture(t); const p = { baseUrl: 'https://example.org/v1', model: 'm', visionModel: 'v' };
  assert.equal(api.applyProfileForm(p, { baseUrl: 'https://other.org', temperature: 9 }).ok, false);
  assert.equal(p.baseUrl, 'https://example.org/v1');
  assert.equal(api.applyProfileForm(p, { visionModel: '' }).ok, true); assert.equal(p.visionModel, '');
});
test('API：空 Temperature 不发送，0 则发送', t => {
  const { api } = fixture(t);
  assert.equal('temperature' in api.withProfileTemperature({ temperature: '' }, { temperature: 1, model: 'x' }), false);
  assert.equal(api.withProfileTemperature({ temperature: 0 }, {}).temperature, 0);
});
for (const event of ['ontimeout', 'onerror', 'onabort']) test('API：' + event + ' 会结束 Promise', async t => {
  const { api, calls } = fixture(t);
  const promise = api.chatCompletion({ baseUrl: 'https://example.org/v1', apiKey: 'test' }, { model: 'x' });
  calls[0][event]({}); await assert.rejects(promise);
});
test('API：HTTP 429 及非 JSON 返回明确错误', async t => {
  const { api, calls } = fixture(t); const p = { baseUrl: 'https://example.org/v1', apiKey: 'test' };
  const first = api.chatCompletion(p, {}); calls[0].onload({ status: 429, responseText: '{}' }); await assert.rejects(first, /429/);
  const second = api.chatCompletion(p, {}); calls[1].onload({ status: 200, responseText: 'HTML' }); await assert.rejects(second, /解析/);
});
test('API：成功返回后迟来的超时回调不重复改变状态', async t => {
  const { api, calls } = fixture(t);
  const promise = api.chatCompletion({ baseUrl: 'https://example.org/v1', apiKey: 'test' }, {});
  calls[0].onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) }); calls[0].ontimeout();
  assert.equal((await promise).choices[0].message.content, 'OK');
});
test('图像：JPEG / PNG / 完整 WebP data URL 的 MIME 保留', t => {
  const { api } = fixture(t);
  assert.equal(api.imageDataUrl('/9j/AAA'), 'data:image/jpeg;base64,/9j/AAA');
  assert.equal(api.imageDataUrl('iVBORAAA'), 'data:image/png;base64,iVBORAAA');
  assert.equal(api.imageDataUrl('data:image/webp;base64,UklGR'), 'data:image/webp;base64,UklGR');
});
test('答案：负号、英文短语及单空逗号不被拆除', t => {
  const { api } = fixture(t); const p = { problemType: '4', blanks: [{}] };
  assert.deepEqual(plain(api.parseAIAnswer(p, '答案: -1.25\n解释: x')), ['-1.25']);
  assert.deepEqual(plain(api.parseAIAnswer(p, '答案: New York')), ['New York']);
  assert.deepEqual(plain(api.parseAIAnswer(p, '答案: (1, 2)')), ['(1, 2)']);
});
test('答案：多空 JSON 数组及多行主观题解析', t => {
  const { api } = fixture(t);
  assert.deepEqual(plain(api.parseAIAnswer({ problemType: 4, blanks: [{}, {}] }, '答案: ["a b", "-2"]\n解释: x')), ['a b', '-2']);
  assert.deepEqual(plain(api.parseAIAnswer({ problemType: 5 }, '答案:\n第一行\n第二行\n解释: 原因')), { content: '第一行\n第二行', pics: [] });
});
test('答案：拒绝 NO_PROMPT、无效选项和单选多个字母', t => {
  const { api } = fixture(t); const p = { problemType: 1, options: [{ key: 'A' }, { key: 'B' }] };
  assert.equal(api.parseAIAnswer(p, 'STATE: NO_PROMPT\nSUMMARY: 无题目'), null);
  assert.equal(api.parseAIAnswer(p, '答案: C'), null);
  assert.equal(api.parseAIAnswer(p, '答案: A,B'), null);
  assert.equal(api.parseAIAnswer(p, '答案: ABC reasoning'), null);
});
test('答案：人工编辑去重，多空个数不匹配禁止提交', t => {
  const { api } = fixture(t);
  assert.deepEqual(plain(api.parseEditedAnswer({ problemType: 2 }, 'a,b,a')), ['A', 'B']);
  assert.throws(() => api.parseEditedAnswer({ problemType: 4, blanks: [{}, {}] }, '["one"]'), /2/);
});
test('课堂：解锁先于课件到达仍提醒，课件到达后补齐状态', t => {
  const { api } = fixture(t); api.ui.notifyClassroomEvent = () => {};
  const payload = { prob: 99, sid: 88, pres: 77, dt: Date.now(), limit: 60 };
  api.actions.onUnlockProblem(payload); assert.equal(api.repo.pendingUnlocks.size, 1);
  api.actions.onPresentationLoaded('77', { slides: [{ id: '88', problem: { problemId: '99', problemType: 1 } }] });
  assert.equal(api.repo.pendingUnlocks.size, 0); assert.ok(api.repo.problemStatus.get(99));
});
test('课堂：相同解锁帧不覆盖已在分析的状态', t => {
  const { api } = fixture(t); api.ui.notifyClassroomEvent = () => {};
  api.repo.upsertSlide({ id: 88 }); api.repo.upsertProblem({ problemId: 99, problemType: 1 });
  const payload = { prob: '99', sid: '88', dt: Date.now(), limit: '60' };
  api.actions.onUnlockProblem(payload); const first = api.repo.problemStatus.get(99); first.answering = true;
  api.actions.onUnlockProblem(payload); assert.equal(api.repo.problemStatus.get(99), first);
});
test('自动作答：关闭后排队取消，重新开启也不复活旧任务', t => {
  const { api } = fixture(t); const problem = { problemId: 1, problemType: 1 };
  api.repo.upsertProblem(problem); api.ui.config.autoAnswer = true;
  const status = { lessonId: null, endTime: Date.now() + 60000, autoAnswerTime: Date.now() + 1000 };
  api.repo.problemStatus.set(1, status); assert.equal(api.canAutoSubmit(problem, status), true);
  api.ui.config.autoAnswer = false; api.ui.saveConfig(); assert.equal(status.autoAnswerTime, null);
  api.ui.config.autoAnswer = true; assert.equal(api.canAutoSubmit(problem, status), false);
});
test('自动作答：无 API Key 不提交占位答案', async t => {
  const { api, calls } = fixture(t); api.ui.notifyClassroomEvent = () => {}; api.ui.toast = () => {};
  api.ui.config.autoAnswer = true;
  const problem = { problemId: 1, problemType: 1 }; api.repo.upsertProblem(problem);
  const status = { lessonId: null, endTime: Date.now() + 60000 }; api.repo.problemStatus.set(1, status);
  await api.handleAutoAnswerInternal(problem); assert.equal(calls.length, 0); assert.notEqual(status.answering, true); assert.equal(status.done, undefined);
});
test('提交：已过截止必须显式选择补交', async t => {
  const { api } = fixture(t);
  await assert.rejects(api.submitAnswer({ problemId: 1, problemType: 1 }, ['A'], { endTime: Date.now() - 100, autoGate: false }), error => error.name === 'DeadlineError');
});
test('WebSocket：CLOSED 不算已连接，允许重连', t => {
  const { api } = fixture(t); api.repo.markLessonConnected('1', { readyState: 3 }, 'token');
  assert.equal(api.repo.isLessonConnected('1'), false); api.repo.lessonSockets.set('1', { readyState: 0 }); assert.equal(api.repo.isLessonConnected('1'), true);
});
test('XHR：拦截保留原 open 的 user/password 参数', t => {
  const { w, api } = fixture(t); const seen = [];
  w.XMLHttpRequest.prototype.open = function(...args) { seen.push(args); };
  api.installXHRInterceptor(); new w.XMLHttpRequest().open('GET', '/x', true, 'user', 'password');
  assert.deepEqual(seen[0], ['GET', '/x', true, 'user', 'password']);
});
test('界面：真实入口挂载所有面板，设置可保存 0 音量', async t => {
  const { w, api, errors } = fixture(t, { main: true }); await flush();
  assert.equal(w.document.querySelectorAll('#ykt-helper-toolbar').length, 1);
  assert.ok(w.document.querySelector('#ykt-config-export')); assert.ok(w.document.querySelector('#ykt-ai-test'));
  w.document.querySelector('#ykt-input-notify-volume').value = '0';
  w.document.querySelector('#ykt-btn-settings-save').click(); await flush();
  assert.equal(api.ui.config.notifyVolume, 0); assert.deepEqual(errors, []);
});
test('界面：Profile 切换保存草稿，但不改动运行配置', async t => {
  const { w, api } = fixture(t, { config: { ai: { profiles: [{ id: 'a', name: 'a', baseUrl: 'https://a.org/v1', model: 'x' }, { id: 'b', name: 'b', baseUrl: 'https://b.org/v1', model: 'y' }], activeProfileId: 'a' } } });
  api.mountSettingsPanel(); const select = w.document.querySelector('#ykt-ai-profile-select');
  w.document.querySelector('#ykt-ai-model').value = 'changed';
  select.value = 'b'; select.dispatchEvent(new w.Event('change')); select.value = 'a'; select.dispatchEvent(new w.Event('change'));
  assert.equal(w.document.querySelector('#ykt-ai-model').value, 'changed'); assert.equal(api.ui.config.ai.profiles[0].model, 'x');
  w.document.querySelector('#ykt-btn-settings-save').click(); await flush(); assert.equal(api.ui.config.ai.profiles[0].model, 'changed');
});
test('界面：编辑区实时校验，重置按钮恢复建议', t => {
  const { w, api } = fixture(t); api.mountAIPanel(); api.setAnswerEditor({ problemId: 1, problemType: 1, options: [{ key: 'A' }] }, ['A']);
  const editor = w.document.querySelector('#ykt-ai-answer-edit'), button = w.document.querySelector('#ykt-ai-submit');
  assert.equal(button.disabled, false); editor.value = 'B'; editor.dispatchEvent(new w.Event('input')); assert.equal(button.disabled, true);
  w.document.querySelector('#ykt-ai-reset-edit').click(); assert.equal(editor.value, '[\n  "A"\n]'); assert.equal(button.disabled, false);
});
test('界面：移动端入口只挂载提醒，不挂载桌面工具栏', async t => {
  const { w, errors } = fixture(t, { pathname: '/m/v2/index', main: true }); await flush();
  assert.ok(w.document.querySelector('#ykt-mobile-reminder-root')); assert.equal(w.document.querySelector('#ykt-helper-toolbar'), null); assert.deepEqual(errors, []);
});
test('SPA：课堂切换清理旧题目和状态', t => {
  const { w, api } = fixture(t, { pathname: '/lesson/fullscreen/v3/one' });
  api.repo.upsertProblem({ problemId: 1 }); api.repo.problemStatus.set(1, {});
  w.history.pushState(null, '', '/lesson/fullscreen/v3/two'); api.actions.launchLessonHelper();
  assert.equal(api.repo.currentLessonId, 'two'); assert.equal(api.repo.problems.size, 0); assert.equal(api.repo.problemStatus.size, 0);
});
test('渲染：课件标题及 AI HTML 不可直接注入', t => {
  const { api } = fixture(t);
  assert.equal(api.mdToHtml('<img src=x onerror=alert(1)>').includes('<img'), false);
  assert.equal(api.mdToHtml('[x](javascript:alert(1))').includes('<a '), false);
});
test('旧配置：根级空默认 Profile 不遮蔽 ai.kimiApiKey', t => {
  const { api } = fixture(t, { config: { profiles: [{ id: 'default', apiKey: '' }], ai: { kimiApiKey: 'legacy' } } });
  assert.equal(api.ui.config.ai.profiles[0].apiKey, 'legacy');
});
test('导出：备份文件不包含所有已知 API Key 字段', async t => {
  const { w, api } = fixture(t); let captured;
  api.mountSettingsPanel();
  api.ui.config.ai.profiles[0].apiKey = 'profile-secret'; api.ui.config.ai.ocrApiKey = 'ocr-secret'; api.ui.config.ai.translateApiKey = 'translation-secret'; api.ui.config.ai.kimiApiKey = 'legacy-secret';
  w.URL.createObjectURL = blob => { captured = blob; return 'blob:test'; }; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  w.document.querySelector('#ykt-config-export').click();
  const reader = new w.FileReader();
  const text = await new Promise(resolve => { reader.onload = () => resolve(reader.result); reader.readAsText(captured); });
  assert.equal(/profile-secret|ocr-secret|translation-secret|legacy-secret/.test(text), false);
  assert.equal(JSON.parse(text).format, 'ykt-helper-config');
});
test('导入：新地址不复用旧密钥，自动行为默认关闭', async t => {
  const { w, api } = fixture(t); api.mountSettingsPanel();
  api.ui.config.ai.profiles[0].apiKey = 'old-secret'; api.ui.config.ai.ocrApi = 'https://old.org/v1'; api.ui.config.ai.ocrApiKey = 'old-ocr';
  const config = plain(api.ui.config);
  config.ai.profiles[0].baseUrl = 'https://new.org/v1'; config.ai.profiles[0].apiKey = 'imported-secret';
  config.ai.ocrApi = 'https://new.org/v1'; config.ai.ocrApiKey = 'imported-ocr';
  config.autoAnswer = config.autoJoinEnabled = config.autoAnswerOnAutoJoin = true; config.notifyVolume = 0;
  const input = w.document.querySelector('#ykt-config-file');
  Object.defineProperty(input, 'files', { value: [{ size: 1000, text: async () => JSON.stringify({ format: 'ykt-helper-config', version: 1, config }) }] });
  await input.onchange();
  assert.equal(api.ui.config.ai.profiles[0].apiKey, ''); assert.equal(api.ui.config.ai.ocrApiKey, ''); assert.equal(api.ui.config.autoAnswer, false); assert.equal(api.ui.config.autoJoinEnabled, false); assert.equal(api.ui.config.notifyVolume, 0);
});
test('导入：非法格式不修改运行配置', async t => {
  const { w, api } = fixture(t); api.mountSettingsPanel(); const before = JSON.stringify(api.ui.config);
  const input = w.document.querySelector('#ykt-config-file');
  Object.defineProperty(input, 'files', { value: [{ size: 10, text: async () => '{"version":999}' }] });
  await input.onchange(); assert.equal(JSON.stringify(api.ui.config), before);
  assert.match(w.document.querySelector('#ykt-config-status').textContent, /失败/);
});
test('编辑提交：一次点击提交验证后的答案，并更新已作答状态', async t => {
  const { w, api } = fixture(t); const requests = [];
  w.XMLHttpRequest.prototype.open = function(method, url) { this.__url = url; };
  w.XMLHttpRequest.prototype.setRequestHeader = () => {};
  w.XMLHttpRequest.prototype.send = function(data) {
    requests.push({ url: this.__url, data: JSON.parse(data) });
    Object.defineProperty(this, 'status', { value: 200 }); Object.defineProperty(this, 'responseText', { value: '{"code":0}' });
    this.onload();
  };
  api.mountAIPanel(); api.ui.toast = () => {};
  const problem = { problemId: 12, problemType: 1, options: [{ key: 'A' }] }; api.repo.upsertProblem(problem);
  api.repo.problemStatus.set(12, { endTime: Date.now() + 10000 }); api.setAnswerEditor(problem, ['A']);
  const button = w.document.querySelector('#ykt-ai-submit'); button.click(); button.click(); await flush();
  assert.equal(requests.length, 1); assert.equal(requests[0].url, '/api/v3/lesson/problem/answer');
  assert.deepEqual(requests[0].data.result, ['A']); assert.equal(api.repo.problemStatus.get(12).done, true);
});
test('SPA：手机/桌面切换后恢复对应工具栏', async t => {
  const { w, api } = fixture(t, { main: true }); await flush();
  w.history.pushState(null, '', '/m/v2/index'); await flush();
  assert.equal(w.document.querySelector('#ykt-helper-toolbar').hidden, true);
  w.history.pushState(null, '', '/v2/web/index'); await flush();
  assert.equal(w.document.querySelector('#ykt-helper-toolbar').hidden, false);
  assert.equal(w.document.querySelector('#ykt-mobile-reminder-root').hidden, true);
});
test('PDF：缺图页跳过，JPEG 页使用正确格式，按钮恢复', async t => {
  const { w, api } = fixture(t); const entries = [], notices = [];
  api.bootCurrentRuntime(); api.ui.toast = text => notices.push(text);
  w.Image = class { constructor() { this.width = this.naturalWidth = 100; this.height = this.naturalHeight = 60; } set src(value) { if (value) queueMicrotask(() => this.onload?.()); } };
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/';
  w.jspdf = { jsPDF: class { addPage() { entries.push('page'); } addImage(data, type) { entries.push(type); } save(name) { entries.push(name); } } };
  api.ui.config.showAllSlides = true;
  api.repo.presentations.set(1, { title: 'demo', slides: [{ id: 1 }, { id: 2, cover: 'https://example.org/a.jpg' }] });
  api.repo.currentPresentationId = 1; await api.downloadPresentationPDF();
  assert.deepEqual(entries, ['JPEG', 'demo.pdf']); assert.match(notices.at(-1), /1 页失败/);
  assert.equal(w.document.querySelector('#ykt-download-pdf').disabled, false);
});
function mockPDF(w) {
  const pages = [], saves = [], loads = [];
  w.Image = class {
    constructor() { this.width = this.naturalWidth = 100; this.height = this.naturalHeight = 60; }
    set src(value) { if (value) { loads.push(value); queueMicrotask(() => value.includes('broken') ? this.onerror?.() : this.onload?.()); } }
  };
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/';
  w.jspdf = { jsPDF: class { addPage() {} addImage() { pages.push('image'); } save(name) { saves.push(name); } } };
  return { pages, saves, loads };
}
test('完整 PDF：默认只看题目页时仍导出全部页，不改变浏览筛选', async t => {
  const { w, api } = fixture(t); api.bootCurrentRuntime(); api.ui.toast = () => {};
  const { pages, saves, loads } = mockPDF(w);
  api.ui.config.showAllSlides = false;
  api.repo.presentations.set('full', { title: '课程', slides: [
    { id: 1, cover: 'https://example.org/one.jpg' },
    { id: 2, cover: 'https://example.org/two.jpg', problem: { problemId: 2, problemType: 1 } },
    { id: 3, cover: 'https://example.org/three.jpg' }
  ] });
  api.repo.currentPresentationId = 'full';
  w.document.querySelector('#ykt-download-full-pdf').click(); await flush(); await flush();
  assert.equal(pages.length, 3); assert.deepEqual(saves, ['课程-完整课件.pdf']);
  assert.deepEqual(loads, ['https://example.org/one.jpg', 'https://example.org/two.jpg', 'https://example.org/three.jpg']);
  assert.equal(api.ui.config.showAllSlides, false);
  assert.equal(w.document.querySelector('#ykt-download-full-pdf').disabled, false);
  assert.equal(w.document.querySelector('#ykt-download-pdf').disabled, false);
});
test('按筛选 PDF：仍只导出题目页', async t => {
  const { w, api } = fixture(t); api.bootCurrentRuntime(); api.ui.toast = () => {};
  const { pages, saves } = mockPDF(w); api.ui.config.showAllSlides = false;
  api.repo.presentations.set('filtered', { title: '课程', slides: [
    { id: 1, cover: 'https://example.org/one.jpg' },
    { id: 2, cover: 'https://example.org/two.jpg', problem: { problemId: 2, problemType: 1 } }
  ] }); api.repo.currentPresentationId = 'filtered';
  await api.downloadPresentationPDF(); assert.equal(pages.length, 1); assert.deepEqual(saves, ['课程.pdf']);
});
test('完整 PDF：缺页或图片错误不会保存缺页文件', async t => {
  const { w, api } = fixture(t); api.bootCurrentRuntime(); const notices = []; api.ui.toast = text => notices.push(text);
  const { saves } = mockPDF(w);
  api.repo.presentations.set('broken', { slides: [
    { id: 1, cover: 'https://example.org/one.jpg' }, { id: 2 }, { id: 3, cover: 'https://example.org/broken.jpg' }
  ] }); api.repo.currentPresentationId = 'broken';
  await api.downloadPresentationPDF({ scope: 'all' });
  assert.equal(saves.length, 0); assert.match(notices.at(-1), /第 2、3 页读取失败/);
  assert.equal(w.document.querySelector('#ykt-download-full-pdf').disabled, false);
});
test('课件标题下载：使用指定课件并导出全部页', async t => {
  const { w, api } = fixture(t); api.bootCurrentRuntime(); api.ui.toast = () => {};
  const { pages, saves } = mockPDF(w); api.ui.config.showAllSlides = false;
  const presentation = { id: 'another', title: '另一份课件', slides: [{ id: 1, cover: 'https://example.org/one.jpg' }] };
  api.repo.presentations.set(presentation.id, presentation); api.repo.currentPresentationId = 'missing';
  api.downloadPresentation(presentation); await flush(); await flush();
  assert.equal(pages.length, 1); assert.deepEqual(saves, ['另一份课件-完整课件.pdf']);
});
test('提交凭据：Cookie CSRF 与页面令牌；不拼接 Bearer null', t => {
  const { w, api } = fixture(t);
  assert.equal('Authorization' in api.getSiteHeaders(), false);
  w.document.cookie = 'csrftoken=csrf-test; path=/';
  w.Authorization = 'page-token'; w.localStorage.setItem('Authorization', 'stale');
  const headers = api.getSiteHeaders(); assert.equal(headers.Authorization, 'Bearer page-token'); assert.equal(headers['X-CSRFToken'], 'csrf-test');
  w.Authorization = 'Bearer ready'; assert.equal(api.getSiteHeaders().Authorization, 'Bearer ready');
});
test('提交协议：优先复用网页请求封装和 API 路径；题型发送数字', async t => {
  const { w, api } = fixture(t); const requests = [];
  w.API = { lesson: { answer_problem: '/api/v3/lesson/problem/answer' } };
  w.request = { post: async (url, payload) => { requests.push({ url, payload }); return { code: 0 }; } };
  const result = await api.submitAnswer({ problemId: 1, problemType: '1' }, ['A'], { autoGate: false });
  assert.equal(result.route, 'answer'); assert.equal(requests.length, 1); assert.equal(requests[0].payload.problemType, 1);
  assert.equal(api.submissionDiagnostics.at(-1).stage, '提交成功');
});
test('提交协议：原生请求拒绝不再发第二个 XHR，显示业务码', async t => {
  const { w, api } = fixture(t); let xhrRequests = 0;
  w.request = { post: async () => { throw { code: 50028, msg: 'already answered' }; } };
  w.XMLHttpRequest.prototype.send = () => xhrRequests++;
  await assert.rejects(api.submitAnswer({ problemId: 1, problemType: 1 }, ['A'], { autoGate: false }), /50028/);
  assert.equal(xhrRequests, 0); assert.equal(api.submissionDiagnostics.at(-1).stage, '提交失败');
});
test('提交协议：未知/跨域接口不带凭据提交', async t => {
  const { w, api } = fixture(t); let calls = 0;
  w.API = { lesson: { answer_problem: 'https://other.org/api/v3/lesson/problem/answer' } };
  w.request = { post: async () => { calls++; return { code: 0 }; } };
  await assert.rejects(api.submitAnswer({ problemId: 1, problemType: 1 }, ['A'], { autoGate: false }), /接口/); assert.equal(calls, 0);
});
test('答案解析：Markdown、方括号和明确 boxed 选择答案', t => {
  const { api } = fixture(t); const p = { problemType: 1, options: [{ key: 'A' }] };
  for (const text of ['答案: **A**\n解释: x', '**答案：A**\n解释：x', '答案: [A]\n解释: x', '答案: \\boxed{A}']) assert.deepEqual(plain(api.parseAIAnswer(p, text)), ['A']);
  assert.deepEqual(plain(api.parseAIAnswer({ problemType: 2 }, '答案: [A、C]')), ['A', 'C']);
});
test('不限时题目：limit=-1 状态可用于统一队列，不误判过期', t => {
  const { api } = fixture(t); api.ui.notifyClassroomEvent = () => {}; api.ui.toast = () => {};
  api.ui.config.autoAnswer = true; const problem = { problemId: 10, problemType: 1 }; api.repo.upsertProblem(problem); api.repo.upsertSlide({ id: 20 });
  api.actions.onUnlockProblem({ prob: 10, sid: 20, dt: Date.now() - 10000, limit: -1 });
  const status = api.repo.problemStatus.get(10); assert.equal(status.endTime, Infinity); assert.equal(status.autoAnswerTime, null); assert.equal(api.canAutoSubmit(problem, status), true);
});
test('实时状态：老师续时更新截止；关闭题目取消任务', t => {
  const { api } = fixture(t); const status = { endTime: Date.now() - 1, autoAnswerTime: 1 };
  api.repo.problemStatus.set(1, status);
  api.dispatchRealtimeMessage({ op: 'extendtime', problem: { prob: 1, limit: -1 } }, { handlers: { onProblemTiming: data => api.actions.onProblemTiming(data) } });
  assert.equal(status.endTime, Infinity);
  api.dispatchRealtimeMessage({ op: 'problemfinished', prob: 1 }, { handlers: { onProblemClosed: id => api.actions.onProblemClosed(id) } });
  assert.equal(status.cancelled, true); assert.equal(status.autoAnswerTime, null);
});
test('实时状态：服务器 now/dt 用相对剩余时间，避免本地时钟偏差', t => {
  const { api } = fixture(t); api.repo.problemStatus.set(1, {}); const before = Date.now();
  api.actions.onProblemTiming({ problemid: 1, limit: 60, dt: 100000, now: 130000 });
  const deadline = api.repo.problemStatus.get(1).endTime;
  assert.ok(deadline >= before + 30000 && deadline <= Date.now() + 30000);
});
test('诊断：无效答案在提交前记录失败，不包含答案内容', async t => {
  const { api } = fixture(t); await assert.rejects(api.submitAnswer({ problemId: 1, problemType: 1, options: [{ key: 'A' }] }, ['B'], { autoGate: false }), /无效/);
  assert.equal(api.submissionDiagnostics.at(-1).stage, '提交失败'); assert.equal('result' in api.submissionDiagnostics.at(-1), false);
});
function manualFixture(t, { unlocked = true } = {}) {
  const f = fixture(t, { pathname: '/lesson/fullscreen/v3/lesson-one' });
  const { w, api } = f;
  api.bootCurrentRuntime(); api.ui.toast = () => {}; api.ui.notifyClassroomEvent = () => {};
  api.ui.config.manualAutoSubmit = true; api.ui.config.autoAnswer = false;
  const requests = []; w.request = { post: async (url, body) => { requests.push({ url, body }); return { code: 0 }; } };
  const problem = { problemId: 11, problemType: 1, options: [{ key: 'A', value: '甲' }, { key: 'B', value: '乙' }] };
  const slide = { id: 21, problem }; api.repo.upsertProblem(problem); api.repo.upsertSlide(slide);
  api.repo.encounteredProblems.push({ problemId: 11, problemType: 1, slide, presentationId: 31 });
  if (unlocked) api.actions.onUnlockProblem({ prob: 11, sid: 21, pres: 31, dt: Date.now() - 1000, limit: 60 });
  const state = w.document.querySelector('#app').__vue__.$store.state;
  return { ...f, requests, problem, state };
}
test('预填：网页切到匹配题目且开放后只提交一次，不调用 AI', async t => {
  const { api, state, problem, requests, calls } = manualFixture(t);
  api.saveManualAnswer(problem, 'B'); await api.tickManualAutoSubmit(); assert.equal(requests.length, 0);
  state.currSlide = { type: 3, sid: 21, problemID: 11 };
  await Promise.all([api.tickManualAutoSubmit(), api.tickManualAutoSubmit()]); await api.tickManualAutoSubmit();
  assert.equal(requests.length, 1); assert.deepEqual(plain(requests[0].body.result), ['B']); assert.equal(calls.length, 0);
  assert.equal(api.repo.manualAnswers.get(11).state, 'submitted'); assert.equal(api.repo.problemStatus.get(11).done, true);
});
test('预填：先切页但题目未开放时等待，解锁到达后提交', async t => {
  const { api, state, problem, requests } = manualFixture(t, { unlocked: false });
  api.saveManualAnswer(problem, 'A'); state.currSlide = { type: 3, sid: 21, problemID: 11 };
  await api.tickManualAutoSubmit(); assert.equal(requests.length, 0);
  api.actions.onUnlockProblem({ prob: 11, sid: 21, dt: Date.now() - 1000, limit: -1 }); await flush(); await flush();
  assert.equal(requests.length, 1);
});
test('预填：另一道题、普通课件页及助手预览都不触发', async t => {
  const { api, state, problem, requests } = manualFixture(t); api.saveManualAnswer(problem, 'A');
  for (const info of [{ type: 3, sid: 22, problemID: 12 }, { type: 2, sid: 21, problemID: 11 }]) { state.currSlide = info; await api.tickManualAutoSubmit(); }
  state.currSlide = null; api.repo.currentSlideId = '21'; await api.tickManualAutoSubmit(); assert.equal(requests.length, 0);
});
test('预填：关闭模式和取消排队阻止提交', async t => {
  const { api, state, problem, requests } = manualFixture(t); api.saveManualAnswer(problem, 'A');
  state.currSlide = { type: 3, sid: 21, problemID: 11 }; api.ui.config.manualAutoSubmit = false;
  await api.tickManualAutoSubmit(); assert.equal(requests.length, 0);
  api.ui.config.manualAutoSubmit = true; api.cancelManualAnswer(11); await api.tickManualAutoSubmit(); assert.equal(requests.length, 0);
});
test('预填：截止、老师关闭、已作答都不提交', async t => {
  const { api, state, problem, requests } = manualFixture(t); state.currSlide = { type: 3, sid: 21, problemID: 11 };
  const status = api.repo.problemStatus.get(11);
  api.saveManualAnswer(problem, 'A'); status.endTime = Date.now() - 1; await api.tickManualAutoSubmit();
  status.endTime = Infinity; api.actions.onProblemClosed(11); await api.tickManualAutoSubmit();
  status.cancelled = false; status.endTime = Infinity; problem.result = ['B']; api.saveManualAnswer(problem, 'A'); await api.tickManualAutoSubmit();
  assert.equal(requests.length, 0);
});
test('预填：提交失败保留原因，轮询不重发，显式重新排队才重发', async t => {
  const { w, api, state, problem } = manualFixture(t); let count = 0;
  w.request.post = async () => { count++; return { code: 1, msg: '测试拒绝' }; };
  api.saveManualAnswer(problem, 'A'); state.currSlide = { type: 3, sid: 21, problemID: 11 };
  await api.tickManualAutoSubmit(); await api.tickManualAutoSubmit();
  assert.equal(count, 1); assert.equal(api.repo.manualAnswers.get(11).state, 'failed'); assert.match(api.repo.manualAnswers.get(11).error, /拒绝/);
  api.saveManualAnswer(problem, 'B'); await api.tickManualAutoSubmit(); assert.equal(count, 2);
});
test('预填：保存队列可恢复，未确认提交刷新后不自动重发', t => {
  const { w, api, problem } = manualFixture(t); api.saveManualAnswer(problem, 'B'); api.repo.manualAnswers.clear(); api.loadManualAnswers();
  assert.equal(api.repo.manualAnswers.get(11).armed, true);
  const entries = JSON.parse(w.localStorage.getItem('ykt-helper:manual-answers-lesson-one')); entries[0][1].state = 'submitting'; entries[0][1].attempted = true; entries[0][1].armed = false;
  w.localStorage.setItem('ykt-helper:manual-answers-lesson-one', JSON.stringify(entries)); api.loadManualAnswers();
  assert.equal(api.repo.manualAnswers.get(11).state, 'unknown'); assert.equal(api.repo.manualAnswers.get(11).armed, false);
});
test('预填：切换课堂不拿旧答案提交到新课堂', async t => {
  const { w, api, state, problem, requests } = manualFixture(t); api.saveManualAnswer(problem, 'A');
  w.history.pushState(null, '', '/lesson/fullscreen/v3/lesson-two'); api.actions.launchLessonHelper();
  assert.equal(api.repo.manualAnswers.size, 0); state.currSlide = { type: 3, sid: 21, problemID: 11 }; await api.tickManualAutoSubmit(); assert.equal(requests.length, 0);
});
test('设置：AI 自动分析和预填提交可同时启用，共用题目状态', async t => {
  const { w, api, state, problem, requests } = manualFixture(t);
  const ai = w.document.querySelector('#ykt-input-auto-answer'), own = w.document.querySelector('#ykt-manual-auto-submit');
  ai.checked = true; own.checked = true; own.dispatchEvent(new w.Event('change')); assert.equal(ai.checked, true);
  w.document.querySelector('#ykt-btn-settings-save').click(); await flush();
  assert.equal(api.ui.config.manualAutoSubmit, true); assert.equal(api.ui.config.autoAnswer, true);
  api.saveManualAnswer(problem, 'A'); state.currSlide = { type: 3, sid: 21, problemID: 11 }; await api.tickManualAutoSubmit(); assert.equal(requests.length, 1);
  const entry = w.document.querySelector('#ykt-btn-own-answer');
  assert.equal(w.document.querySelector('#ykt-btn-auto-answer'), null); assert.equal(w.document.querySelector('#ykt-btn-ai'), null);
  assert.match(entry.textContent, /答题中心/); entry.click();
  assert.equal(api.ui.config.autoAnswer, true); assert.equal(api.ui.config.manualAutoSubmit, true);
  assert.equal(entry.getAttribute('aria-expanded'), 'true');
  w.document.querySelector('#ykt-center-auto-ai').click(); assert.equal(api.ui.config.manualAutoSubmit, true); assert.equal(api.ui.config.autoAnswer, false);
  w.document.querySelector('#ykt-problem-list-close').click(); assert.equal(entry.getAttribute('aria-expanded'), 'false');
  assert.match(entry.title, /自动 AI 预填：关/);
});
test('界面：自己答题入口、选项控件和排队按钮可用，改答案会取消旧排队', t => {
  const { w, api, problem } = manualFixture(t); api.ui.updateProblemList();
  assert.ok(w.document.querySelector('#ykt-btn-own-answer'));
  const row = w.document.querySelector('.problem-row'), textarea = row.querySelector('.editor-box textarea');
  const fields = row.querySelectorAll('input[name="manual-choice-11"]'); assert.equal(fields.length, 2);
  fields[1].checked = true; fields[1].dispatchEvent(new w.Event('change')); assert.equal(textarea.value, '["B"]');
  row.querySelector('[data-action="queue-manual-answer"]').click(); assert.equal(api.repo.manualAnswers.get(problem.problemId).armed, true);
  textarea.value = 'A'; textarea.dispatchEvent(new w.Event('input')); assert.equal(api.repo.manualAnswers.get(11).armed, false);
});
test('预填：请求发出后切换课堂，迟到响应不改写新课堂的同 ID 题目', async t => {
  const { w, api, state, problem } = manualFixture(t); let resolve;
  w.request.post = () => new Promise(done => resolve = done);
  api.saveManualAnswer(problem, 'A'); state.currSlide = { type: 3, sid: 21, problemID: 11 };
  const pending = api.tickManualAutoSubmit(); await flush();
  w.history.pushState(null, '', '/lesson/fullscreen/v3/lesson-two'); api.actions.launchLessonHelper();
  const other = { problemId: 11, problemType: 1 }; api.repo.upsertProblem(other);
  resolve({ code: 0 }); await pending;
  assert.equal(other.result, undefined);
  const saved = JSON.parse(w.localStorage.getItem('ykt-helper:manual-answers-lesson-one')); assert.equal(saved[0][1].state, 'submitted');
  assert.equal(w.localStorage.getItem('ykt-helper:manual-answers-lesson-two'), null);
});
test('提交：手動按钮与预填队列共用同一请求锁，禁止并发重复提交', async t => {
  const { w, api } = fixture(t); let resolve, count = 0;
  w.request = { post: () => { count++; return new Promise(done => resolve = done); } };
  const p = { problemId: 1, problemType: 1 };
  const first = api.submitAnswer(p, ['A'], { autoGate: false }); await flush();
  await assert.rejects(api.submitAnswer(p, ['B'], { autoGate: false }), /已有提交/);
  resolve({ code: 0 }); await first; assert.equal(count, 1);
});
test('预填：网页已提交的答案取消原有排队，刷新也不复活旧答案', t => {
  const { api, problem } = manualFixture(t); api.saveManualAnswer(problem, 'A');
  api.actions.onAnswerProblem(11, ['B']); assert.equal(api.repo.manualAnswers.get(11).armed, false);
  api.loadManualAnswers(); assert.equal(api.repo.manualAnswers.get(11).armed, false);
});
test('设置可见性：站点隐藏原生 checkbox 时，预填模式仍显示可点击的勾选框', async t => {
  const { w, api, values } = fixture(t, { main: true }); await flush();
  const siteStyle = w.document.createElement('style');
  siteStyle.textContent = 'input[type="checkbox"]{appearance:none!important;display:none!important;opacity:0!important;width:0!important;height:0!important}';
  w.document.head.appendChild(siteStyle);
  const checkbox = w.document.querySelector('#ykt-manual-auto-submit');
  const label = checkbox.closest('label'), marker = label.querySelector('.checkmark');
  assert.ok(marker, '必须提供独立可见的勾选框，不能只依靠原生 input 外观');
  const markerStyle = w.getComputedStyle(marker);
  assert.notEqual(markerStyle.display, 'none'); assert.notEqual(markerStyle.visibility, 'hidden');
  assert.ok(parseFloat(markerStyle.width) >= 16); assert.ok(parseFloat(markerStyle.height) >= 16);
  assert.equal(checkbox.checked, false); label.click(); assert.equal(checkbox.checked, true);
  w.document.querySelector('#ykt-btn-settings-save').click(); await flush();
  assert.equal(api.ui.config.manualAutoSubmit, true); assert.equal(values.get('ykt-helper:config').manualAutoSubmit, true);
});
test('设置可见性：预填开关可获得键盘焦点，重新打开设置保留已保存勾选', async t => {
  const { w, api } = fixture(t, { main: true }); await flush();
  const checkbox = w.document.querySelector('#ykt-manual-auto-submit');
  const label = checkbox.closest('label');
  assert.equal(label.htmlFor, checkbox.id);
  checkbox.focus(); assert.equal(w.document.activeElement, checkbox);
  label.click(); w.document.querySelector('#ykt-btn-settings-save').click(); await flush();
  api.ui.toggleSettingsPanel(); api.ui.toggleSettingsPanel(); api.ui.toggleSettingsPanel();
  assert.equal(checkbox.checked, true);
});
function prepareAI(f) {
  const { api, problem } = f;
  problem.body = '请选择正确的答案。';
  api.ui.config.ai.profiles[0].apiKey = 'test-key';
  api.ui.config.autoAnswerDelay = api.ui.config.autoAnswerRandomDelay = 0;
  return f;
}
function replyAI(call, answer = '答案: A\n解释: 示例理由') {
  call.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: answer } }] }) });
}
test('融合：题目一到达即 AI 分析，答案进入同一编辑区，切页并开放后提交', async t => {
  const f = prepareAI(manualFixture(t, { unlocked: false })); const { api, calls, problem, requests, state, w } = f;
  api.ui.config.autoAnswer = true; api.ui.showProblemListPanel(true);
  api.actions.onPresentationLoaded(31, { slides: [{ id: 21, problem }] });
  assert.equal(calls.length, 1); assert.equal(requests.length, 0);
  replyAI(calls[0], '答案: B\n解释: 选择乙'); await flush(); await flush();
  assert.deepEqual(plain(api.repo.manualAnswers.get(11).answer), ['B']); assert.equal(api.repo.manualAnswers.get(11).source, 'ai');
  assert.deepEqual(JSON.parse(w.document.querySelector('.problem-row .editor-box textarea').value), ['B']);
  assert.equal(requests.length, 0);
  state.currSlide = { type: 3, sid: 21, problemID: 11 };
  api.actions.onUnlockProblem({ prob: 11, sid: 21, dt: Date.now() - 10, limit: -1 }); await flush(); await flush();
  assert.equal(requests.length, 1); assert.deepEqual(plain(requests[0].body.result), ['B']);
});
test('融合：AI 分析期间手动修改，迟到的 AI 不覆盖手填答案', async t => {
  const { api, calls, problem } = prepareAI(manualFixture(t, { unlocked: false }));
  const promise = api.generatePreparedAI(11, { arm: true });
  assert.equal(calls.length, 1);
  api.noteAnswerEdit(11, 'B'); api.saveManualAnswer(problem, 'B', { arm: false });
  replyAI(calls[0], '答案: A'); assert.equal(await promise, null);
  assert.deepEqual(plain(api.repo.manualAnswers.get(11).answer), ['B']); assert.equal(api.repo.manualAnswers.get(11).source, 'manual');
});
test('融合：只预填模式不提交，可在同一区域立即提交 AI 答案', async t => {
  const { api, calls, state, requests, w } = prepareAI(manualFixture(t));
  state.currSlide = { type: 3, sid: 21, problemID: 11 }; api.ui.showProblemListPanel(true);
  const promise = api.generatePreparedAI(11, { policy: 'manual', arm: true }); replyAI(calls[0], '答案: B'); await promise; await flush();
  assert.equal(requests.length, 0); assert.equal(api.repo.manualAnswers.get(11).armed, false);
  w.document.querySelector('[data-action="submit-answer-now"]').click(); await flush(); assert.equal(requests.length, 1);
  assert.deepEqual(plain(requests[0].body.result), ['B']);
});
test('融合：开放即提交策略无需切页，仍等待题目真实开放', async t => {
  const { api, problem, requests } = manualFixture(t, { unlocked: false });
  api.saveManualAnswer(problem, 'B', { policy: 'open' }); await api.tickManualAutoSubmit(); assert.equal(requests.length, 0);
  api.actions.onUnlockProblem({ prob: 11, sid: 21, dt: Date.now() - 10, limit: 60 }); await flush(); await flush(); assert.equal(requests.length, 1);
});
test('融合：自动 AI 不覆盖已保存的人工草稿', async t => {
  const { api, calls, problem } = prepareAI(manualFixture(t, { unlocked: false }));
  api.saveManualAnswer(problem, 'B', { arm: false }); api.ui.config.autoAnswer = true;
  api.actions.onPresentationLoaded(31, { slides: [{ id: 21, problem }] }); await flush();
  assert.equal(calls.length, 0); assert.deepEqual(plain(api.repo.manualAnswers.get(11).answer), ['B']);
});
test('融合：重复课件响应和恢复的同一 AI 草稿不会重复分析', async t => {
  const { api, calls, problem } = prepareAI(manualFixture(t, { unlocked: false })); api.ui.config.autoAnswer = true;
  const presentation = { slides: [{ id: 21, problem }] };
  api.actions.onPresentationLoaded(31, presentation); api.actions.onPresentationLoaded(31, presentation); assert.equal(calls.length, 1);
  replyAI(calls[0]); await flush(); await flush();
  api.loadManualAnswers(); api.actions.onPresentationLoaded(31, presentation); await flush(); assert.equal(calls.length, 1);
});
test('融合：后台分析串行进行，失败不会自动反复调用模型', async t => {
  const { api, calls, problem } = prepareAI(manualFixture(t, { unlocked: false })); api.ui.config.autoAnswer = true;
  const second = { ...problem, problemId: 12, body: '第二道题' };
  const data = { slides: [{ id: 21, problem }, { id: 22, problem: second }] };
  api.actions.onPresentationLoaded(31, data); assert.equal(calls.length, 1);
  replyAI(calls[0], 'STATE: NO_PROMPT\nSUMMARY: 缺少信息'); await flush(); assert.equal(calls.length, 2);
  replyAI(calls[1]); await flush(); await flush(); api.actions.onPresentationLoaded(31, data); await flush();
  assert.equal(calls.length, 2); assert.equal(api.answerAIJobs.get(11).state, 'failed');
});
test('融合：关闭自动 AI 后，未完成的自动结果不再预填或提交', async t => {
  const { api, calls } = prepareAI(manualFixture(t, { unlocked: false }));
  api.ui.config.autoAnswer = true; api.ui.saveConfig(); assert.equal(calls.length, 1);
  api.ui.config.autoAnswer = false; api.ui.saveConfig();
  replyAI(calls[0]); await flush(); await flush(); assert.equal(api.repo.manualAnswers.has(11), false);
});
test('融合：自动分析晚到结果不会写进新课堂', async t => {
  const { api, calls, w } = prepareAI(manualFixture(t, { unlocked: false }));
  const promise = api.generatePreparedAI(11, { arm: true });
  w.history.pushState(null, '', '/lesson/fullscreen/v3/next'); api.actions.launchLessonHelper();
  replyAI(calls[0]); assert.equal(await promise, null); assert.equal(api.repo.manualAnswers.size, 0);
});
test('融合：统一面板控制分析与提交，人工未保存编辑在列表刷新后保留', async t => {
  const { api, w } = manualFixture(t); api.ui.showProblemListPanel(true);
  const input = w.document.querySelector('.problem-row textarea'); input.value = 'B'; input.dispatchEvent(new w.Event('input'));
  api.ui.updateProblemList(); assert.equal(w.document.querySelector('.problem-row textarea').value, 'B');
  assert.ok(w.document.querySelector('#ykt-center-auto-ai')); assert.ok(w.document.querySelector('#ykt-center-auto-submit'));
  w.document.querySelector('#ykt-center-auto-ai').click(); assert.equal(api.ui.config.autoAnswer, true); assert.equal(api.ui.config.manualAutoSubmit, true);
  w.document.querySelector('#ykt-center-auto-submit').click(); assert.equal(api.ui.config.autoAnswer, true); assert.equal(api.ui.config.manualAutoSubmit, false);
});
test('融合：手改 AI 答案后立即提交，保存和界面都反映实际提交的答案', async t => {
  const { api, w, problem, requests } = manualFixture(t); api.saveManualAnswer(problem, 'A', { source: 'ai', policy: 'manual', arm: false });
  api.ui.showProblemListPanel(true);
  const editor = w.document.querySelector('.problem-row textarea'); editor.value = 'B'; editor.dispatchEvent(new w.Event('input'));
  w.document.querySelector('[data-action="submit-answer-now"]').click(); await flush(); await flush();
  assert.deepEqual(plain(requests[0].body.result), ['B']);
  assert.deepEqual(plain(api.repo.manualAnswers.get(11).answer), ['B']); assert.equal(api.repo.manualAnswers.get(11).state, 'submitted');
  assert.deepEqual(JSON.parse(w.document.querySelector('.problem-row textarea').value), ['B']);
});
test('融合：立即提交的迟到响应也不污染新课堂', async t => {
  const { api, w } = manualFixture(t); let resolve;
  w.request.post = () => new Promise(done => resolve = done);
  api.ui.showProblemListPanel(true); w.document.querySelector('.problem-row textarea').value = 'B';
  w.document.querySelector('[data-action="submit-answer-now"]').click(); await flush();
  w.history.pushState(null, '', '/lesson/fullscreen/v3/other'); api.actions.launchLessonHelper();
  const other = { problemId: 11, problemType: 1 }; api.repo.upsertProblem(other);
  resolve({ code: 0 }); await flush(); await flush(); assert.equal(other.result, undefined);
});
test('融合：下课后取消后台自动分析，后续课件响应不再启动自动 AI', async t => {
  const { api, calls, problem } = prepareAI(manualFixture(t, { unlocked: false })); api.ui.config.autoAnswer = true;
  api.actions.onPresentationLoaded(31, { slides: [{ id: 21, problem }] }); assert.equal(calls.length, 1);
  api.actions.onLessonFinished(); replyAI(calls[0]); await flush(); await flush();
  assert.equal(api.repo.manualAnswers.has(11), false);
  api.actions.onPresentationLoaded(32, { slides: [{ id: 22, problem: { ...problem, problemId: 12 } }] }); await flush(); assert.equal(calls.length, 1);
});

function profileUI(f) {
  const { w, api } = f; api.mountSettingsPanel();
  const el = id => w.document.getElementById(id);
  const change = (id, value) => { el(id).value = value; el(id).dispatchEvent(new w.Event('change')); };
  const add = provider => { change('ykt-ai-provider-preset', provider); el('ykt-ai-profile-add').click(); return el('ykt-ai-profile-select').value; };
  return { ...f, el, change, add };
}
test('多服务：预设包含 DeepSeek / GLM / Kimi，自定义不携带任何密钥或旧模型', t => {
  const { api } = fixture(t); const profiles = [];
  for (const provider of ['deepseek', 'glm', 'kimi', 'custom']) {
    const p = api.createAIProfile(provider, profiles); profiles.push(p);
    assert.equal(p.provider, provider); assert.equal(p.apiKey, '');
    if (provider !== 'custom') { assert.ok(p.model); assert.ok(p.visionModel); assert.match(api.makeChatUrl(p), /\/chat\/completions$/); }
    else { assert.equal(p.model, ''); assert.equal(p.baseUrl, ''); assert.equal(p.inputMode, 'text'); }
  }
  assert.equal(new Set(profiles.map(p => p.id)).size, 4);
});
test('多服务：GLM v4、Coding v4、DeepSeek 完整地址正确补全且保留查询参数', t => {
  const { api } = fixture(t);
  for (const baseUrl of ['https://open.bigmodel.cn/api/paas/v4', 'https://open.bigmodel.cn/api/coding/paas/v4/']) {
    assert.equal(api.makeChatUrl({ baseUrl }), baseUrl.replace(/\/$/, '') + '/chat/completions');
  }
  assert.equal(api.makeChatUrl({ baseUrl: 'https://api.deepseek.com/chat/completions' }), 'https://api.deepseek.com/chat/completions');
  assert.equal(api.makeChatUrl({ baseUrl: 'https://proxy.example/api/v2/?tenant=demo' }), 'https://proxy.example/api/v2/chat/completions?tenant=demo');
});
test('多服务：旧 Kimi 配置保留密钥与模型，清除已迁移的全局密钥', t => {
  const { api } = fixture(t);
  const cfg = api.normalizeConfig({ ai: { endpoint: 'https://api.moonshot.cn/v1', kimiApiKey: 'legacy', model: 'moonshot-v1-8k', visionModel: 'moonshot-v1-8k-vision-preview' } });
  const p = cfg.ai.profiles[0];
  assert.equal(p.apiKey, 'legacy'); assert.equal(p.model, 'moonshot-v1-8k'); assert.equal(p.inputMode, 'vision');
  assert.equal(cfg.ai.kimiApiKey, ''); assert.equal(cfg.ai.apiKey, '');
  const next = api.normalizeConfig({ ai: { kimiApiKey: 'legacy', profiles: [api.createAIProfile('glm')] } });
  assert.equal(next.ai.profiles[0].apiKey, '');
});
test('多服务：空白自定义草稿可切走并保存，不被 Kimi 默认值回填', async t => {
  const { api, el, add, change } = profileUI(fixture(t));
  const original = api.ui.config.ai.activeProfileId;
  const id = add('custom'); assert.equal(el('ykt-ai-base-url').value, '');
  change('ykt-ai-profile-select', original); el('ykt-btn-settings-save').click(); await flush();
  const p = api.ui.config.ai.profiles.find(p => p.id === id);
  assert.equal(p.baseUrl, ''); assert.equal(p.model, ''); assert.equal(p.apiKey, '');
  const normalized = api.normalizeConfig(api.ui.config).ai.profiles.find(p => p.id === id);
  assert.equal(normalized.baseUrl, ''); assert.equal(normalized.model, '');
});
test('多服务界面：新增预设不继承密钥，各配置独立保留模式、温度与超时', async t => {
  const { api, el, add, change } = profileUI(fixture(t));
  const original = api.ui.config.ai.activeProfileId; el('ykt-ai-api-key').value = 'kimi-key';
  const deepseek = add('deepseek'); assert.equal(el('ykt-ai-api-key').value, '');
  el('ykt-ai-api-key').value = 'deepseek-key'; el('ykt-ai-profile-name').value = 'DeepSeek 我的配置';
  change('ykt-ai-input-mode', 'text'); el('ykt-ai-temperature').value = '0'; el('ykt-ai-timeout').value = '180';
  const glm = add('glm'); assert.equal(el('ykt-ai-api-key').value, ''); assert.equal(el('ykt-ai-input-mode').value, 'vision');
  el('ykt-ai-api-key').value = 'glm-key';
  change('ykt-ai-profile-select', deepseek);
  assert.equal(el('ykt-ai-api-key').value, 'deepseek-key'); assert.equal(el('ykt-ai-timeout').value, '180');
  assert.equal(el('ykt-ai-temperature').value, '0'); assert.equal(el('ykt-ai-input-mode').value, 'text'); assert.equal(el('ykt-ai-vision-model').disabled, true);
  assert.equal(api.ui.config.ai.profiles.length, 1); assert.equal(api.ui.config.ai.activeProfileId, original);
  el('ykt-btn-settings-save').click(); await flush();
  assert.equal(api.ui.config.ai.activeProfileId, deepseek); assert.equal(api.ui.config.ai.profiles.find(p => p.id === glm).apiKey, 'glm-key');
  assert.equal(api.ui.config.ai.profiles.find(p => p.id === original).apiKey, 'kimi-key');
  assert.equal(api.ui.config.ai.profiles.find(p => p.id === deepseek).timeoutSeconds, 180);
});
test('多服务界面：复制当前保留同地址参数，删除副本不改写原配置', async t => {
  const { api, el, add, change } = profileUI(fixture(t));
  const id = add('glm'); el('ykt-ai-api-key').value = 'glm-key'; el('ykt-ai-model').value = 'glm-custom-model';
  el('ykt-ai-profile-copy').click(); const copy = el('ykt-ai-profile-select').value; assert.notEqual(copy, id);
  assert.equal(el('ykt-ai-api-key').value, 'glm-key'); assert.equal(el('ykt-ai-model').value, 'glm-custom-model');
  assert.match(el('ykt-ai-profile-name').value, /副本/);
  el('ykt-ai-profile-del').click(); assert.equal([...el('ykt-ai-profile-select').options].some(p => p.value === copy), false);
  change('ykt-ai-profile-select', id); el('ykt-btn-settings-save').click(); await flush();
  assert.equal(api.ui.config.ai.profiles.find(p => p.id === id).apiKey, 'glm-key');
});
test('多服务界面：非法超时不部分保存、最后一份配置不能删除', t => {
  const { api, el } = profileUI(fixture(t)); const before = JSON.stringify(api.ui.config);
  el('ykt-ai-timeout').value = '4'; el('ykt-ai-api-key').value = 'new-key'; el('ykt-btn-settings-save').click();
  assert.equal(JSON.stringify(api.ui.config), before);
  el('ykt-ai-profile-del').click(); assert.equal(el('ykt-ai-profile-select').options.length, 1);
});
test('多服务界面：测试读取未保存的 GLM 表单，不改变当前运行配置', async t => {
  const { api, calls, el, add } = profileUI(fixture(t)); const before = JSON.stringify(api.ui.config);
  add('glm'); el('ykt-ai-api-key').value = 'draft-key'; el('ykt-ai-model').value = 'draft-model';
  const promise = el('ykt-ai-test').onclick({ currentTarget: el('ykt-ai-test') });
  assert.equal(calls.length, 1); assert.equal(calls[0].headers.Authorization, 'Bearer draft-key');
  assert.equal(calls[0].url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
  assert.equal(JSON.parse(calls[0].data).model, 'draft-model'); assert.equal(calls[0].timeout, 120000);
  replyAI(calls[0], 'OK'); await promise;
  assert.match(el('ykt-config-status').textContent, /draft-model/); assert.equal(JSON.stringify(api.ui.config), before);
});
test('多服务界面：识图测试发送内置图片，文字模式阻止发送图片', async t => {
  const { calls, el, add, change } = profileUI(fixture(t)); add('deepseek'); el('ykt-ai-api-key').value = 'key';
  const button = el('ykt-ai-test-vision');
  const p = button.onclick({ currentTarget: button }); const payload = JSON.parse(calls[0].data);
  assert.equal(payload.model, 'deepseek-flash'); assert.match(payload.messages[0].content[0].image_url.url, /^data:image\/png;base64,/);
  replyAI(calls[0], '红色'); await p; assert.match(el('ykt-config-status').textContent, /识图测试通过/);
  change('ykt-ai-input-mode', 'text'); await button.onclick({ currentTarget: button });
  assert.equal(calls.length, 1); assert.match(el('ykt-config-status').textContent, /纯文字/);
});
test('多服务界面：识图接口接受图片但回答不符时，不宣称识图测试通过', async t => {
  const { calls, el, add } = profileUI(fixture(t)); add('glm'); el('ykt-ai-api-key').value = 'key';
  const button = el('ykt-ai-test-vision'); const p = button.onclick({ currentTarget: button });
  replyAI(calls[0], 'OK'); await p; assert.match(el('ykt-config-status').textContent, /未确认/);
});
for (const provider of ['deepseek', 'glm', 'kimi']) test(`多服务请求：${provider} 使用自身地址、密钥和模型，非流式调用`, async t => {
  const { api, calls } = fixture(t); const p = api.createAIProfile(provider); p.apiKey = provider + '-key';
  const request = api.chatCompletion(p, { model: p.model, messages: [{ role: 'user', content: 'x' }], stream: true });
  assert.equal(calls[0].url, p.baseUrl); assert.equal(calls[0].headers.Authorization, 'Bearer ' + provider + '-key');
  const payload = JSON.parse(calls[0].data); assert.equal(payload.model, p.model); assert.equal(payload.stream, false); assert.equal('temperature' in payload, false);
  replyAI(calls[0], 'OK'); await request;
});
test('纯文字答题：有课件图片也只发送题干和选项，答案进入统一预填区', async t => {
  const { api, calls, problem } = prepareAI(manualFixture(t, { unlocked: false }));
  const p = api.ui.config.ai.profiles[0]; Object.assign(p, api.createAIProfile('deepseek'), { id: p.id, apiKey: 'key', inputMode: 'text' });
  api.repo.slides.get(21).cover = 'https://slides.example/problem.jpg';
  const pending = api.generatePreparedAI(problem.problemId, { arm: false });
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
  const payload = JSON.parse(calls[0].data); assert.equal(typeof payload.messages[1].content, 'string');
  assert.match(payload.messages[1].content, /A\. 甲/); assert.match(payload.messages[1].content, /未提供图片/);
  assert.equal(calls[0].data.includes('image_url'), false);
  replyAI(calls[0], '答案: B'); await pending;
  assert.deepEqual(plain(api.repo.manualAnswers.get(11).answer), ['B']); assert.equal(api.repo.manualAnswers.get(11).source, 'ai');
});
for (const defect of ['empty', 'image', 'diagram', 'options']) test('纯文字答题：信息缺失 ' + defect + ' 阻止调用与排队', async t => {
  const { api, calls, problem } = prepareAI(manualFixture(t, { unlocked: false })); api.ui.config.ai.profiles[0].inputMode = 'text';
  if (defect === 'empty') problem.body = '<p> </p>';
  if (defect === 'image') problem.body = '<img src="diagram.png">请选择';
  if (defect === 'diagram') problem.body = '请根据下图选择正确答案';
  if (defect === 'options') problem.options[1].value = '';
  await assert.rejects(api.generatePreparedAI(11, { arm: true }), /文字|图文/);
  assert.equal(calls.length, 0); assert.equal(api.repo.manualAnswers.size, 0);
});
test('图文答题：纯文字配置不能从课件分析入口发送图片', async t => {
  const { api, calls } = fixture(t); const p = api.createAIProfile('custom'); p.apiKey = 'key'; p.baseUrl = 'https://model.example/v1'; p.model = 'text-model';
  await assert.rejects(api.queryAIVision('iVBOR', 'test', { profiles: [p], activeProfileId: p.id }), /纯文字/); assert.equal(calls.length, 0);
});
test('图文答题：同配置的视觉与文字模型分两步调用，文字模型不收图片', async t => {
  const { api, calls } = fixture(t); const p = api.createAIProfile('glm'); p.apiKey = 'key'; p.model = 'text-model';
  const promise = api.queryAIVision('iVBOR', 'test', { profiles: [p], activeProfileId: p.id }, { problemType: 1 });
  assert.equal(JSON.parse(calls[0].data).model, p.visionModel);
  replyAI(calls[0], JSON.stringify({ question_type: 'single_choice', stem: '2+2=?', options: { A: '4', B: '5' }, requires_image_for_solution: false })); await flush();
  assert.equal(calls.length, 2); const payload = JSON.parse(calls[1].data);
  assert.equal(payload.model, 'text-model'); assert.equal(calls[1].data.includes('image_url'), false);
  replyAI(calls[1], '答案: A'); assert.equal(await promise, '答案: A');
});
test('多服务答题：调用期间切换配置，迟到结果不预填、不提交', async t => {
  const { api, calls, requests } = prepareAI(manualFixture(t));
  const promise = api.generatePreparedAI(11, { arm: true });
  const glm = api.createAIProfile('glm', api.ui.config.ai.profiles); glm.apiKey = 'glm-key';
  api.ui.config.ai.profiles.push(glm); api.ui.config.ai.activeProfileId = glm.id;
  replyAI(calls[0], '答案: A'); assert.equal(await promise, null);
  assert.equal(api.repo.manualAnswers.size, 0); assert.equal(requests.length, 0);
});
test('OCR：独立 OCR 模型不会错误复用当前纯文字模型', async t => {
  const { api, calls } = fixture(t); const p = api.createAIProfile('deepseek'); p.inputMode = 'text'; p.apiKey = 'text-key';
  const cfg = { profiles: [p], activeProfileId: p.id, ocrApi: 'https://open.bigmodel.cn/api/paas/v4', ocrApiKey: 'ocr-key', ocrModel: 'glm-5.3-flash' };
  const promise = api.queryOCRVision('iVBOR', cfg);
  assert.equal(calls[0].url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions'); assert.equal(calls[0].headers.Authorization, 'Bearer ocr-key');
  assert.equal(JSON.parse(calls[0].data).model, 'glm-5.3-flash'); replyAI(calls[0], '识别的文字'); assert.equal(await promise, '识别的文字');
});
test('多服务导入：保留模板、文字模式和空白草稿；不导入文件中的密钥', async t => {
  const { api, el } = profileUI(fixture(t));
  const p = api.createAIProfile('glm'); Object.assign(p, { apiKey: 'file-secret', inputMode: 'text', timeoutSeconds: 180 });
  const cfg = plain(api.ui.config); cfg.ai.profiles = [p, api.createAIProfile('custom')]; cfg.ai.activeProfileId = p.id;
  const file = el('ykt-config-file');
  Object.defineProperty(file, 'files', { value: [{ size: 1000, text: async () => JSON.stringify({ format: 'ykt-helper-config', version: 1, config: cfg }) }] });
  await file.onchange();
  assert.match(el('ykt-config-status').textContent, /已导入/); assert.equal(api.ui.config.ai.profiles[0].apiKey, '');
  assert.equal(api.ui.config.ai.profiles[0].inputMode, 'text'); assert.equal(api.ui.config.ai.profiles[0].timeoutSeconds, 180);
  assert.equal(api.ui.config.ai.profiles[0].provider, 'glm'); assert.equal(api.ui.config.ai.profiles[1].baseUrl, '');
  assert.equal(el('ykt-ai-input-mode').value, 'text'); assert.equal(el('ykt-ai-timeout').value, '180');
});
test('多服务请求：并行连接使用各自配置的超时、地址和密钥', async t => {
  const { api, calls } = fixture(t);
  const a = api.createAIProfile('deepseek'), b = api.createAIProfile('glm');
  Object.assign(a, { apiKey: 'a-key', timeoutSeconds: 180 }); Object.assign(b, { apiKey: 'b-key', timeoutSeconds: 90 });
  const pa = api.chatCompletion(a, { model: a.model }), pb = api.chatCompletion(b, { model: b.model });
  assert.equal(calls[0].timeout, 180000); assert.equal(calls[1].timeout, 90000);
  assert.equal(calls[0].headers.Authorization, 'Bearer a-key'); assert.equal(calls[1].headers.Authorization, 'Bearer b-key');
  replyAI(calls[1], 'B'); replyAI(calls[0], 'A');
  assert.equal((await pa).choices[0].message.content, 'A'); assert.equal((await pb).choices[0].message.content, 'B');
});
