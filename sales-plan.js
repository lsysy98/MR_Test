(function () {
  'use strict';
  viewNames.push('salesplan');
  var names = ['성진욱', '김무영', '김태홍', '이승엽', '제성규', '송진영', '이현욱'];
  var clinics = ['늘봄', '온유', '맑은미소', '이음', '바른결', '새빛', '한결', '푸른', '온마음', '연세다온', '서울봄', '바른온', '미소담', '더이음', '참좋은', '연세온빛', '서울다정', '하루', '밝은결', '우리봄'];
  var selected = names.includes(ownerInput.value) ? ownerInput.value : '이승엽';
  var el = function (id) { return document.getElementById(id); };
  var monthRows = new Map();
  var fixtureMonths = ['2026-10'];
  var reportPlans = new Map();
  var productGroups = ['3제', '3제+클로르', '클로르'];
  function productGroup(product) {
    var text = String(product || '');
    var chlor = /클로르|CHX/i.test(text);
    var other = text.replace(/클로르\s*(?:\d+\s*ml)?|CHX/gi, '').replace(/[\s,+·]/g, '');
    return chlor ? (other ? '3제+클로르' : '클로르') : '3제';
  }
  // Fictional clients; amount patterns informed by 410 read-only reports (2026-10-18).
  function createRows(fixtureMonth) {
    return names.flatMap(function (owner, oi) {
      var branches = typeof analyticsOwnerBranches !== 'undefined' ? analyticsOwnerBranches[owner] || [] : [];
      var profiles = [
        [[1,1,1,1,2,2,2,3,3,4], [10,10,20,30,50], [20,30,40,70,100]],
        [[1,1,2,2,3,3,3,4,5,6], [10,20,20,40,50], [20,30,40,60,80]],
        [[1,1,2,2,3,3,4,5,9,10], [10,20,30,40,60], [20,20,30,50,80]]
      ];
      var profile = profiles[(oi + Number(fixtureMonth.slice(5))) % profiles.length];
      var distribution = [];
      [2,0,1].forEach(function (group,index) {
        profile[index].forEach(function (amount) { distribution.push({group:group,amount:amount * 10000}); });
      });
      var plans = Array.from({ length: 20 }, function (_, i) {
        var fixture = distribution[(i * 7 + oi * 3 + Number(fixtureMonth.slice(5))) % distribution.length];
        return { owner: owner, client: clinics[(i + oi * 3) % clinics.length] + '치과의원', branch: branches[i % (branches.length || 1)] || '지점 미지정', code: 'D' + (oi + 1) + String(i + 1).padStart(3, '0'), type: '신규', product: productGroups[fixture.group], amount: fixture.amount, day: 1 + (i * 3 + oi) % 28, status: ['방문 예정', '재방문', '성공', '방문 예정', '상담 중'][(i + oi) % 5], followup: i % 7 === 6 ? '다음 달 이월' : i % 5 === 1 ? '이번 달 재방문' : '미정', note: '' };
      });
      return plans;
    });
  }
  function rows() {
    var month = el('planMonth').value;
    var currentMonth = new Date().toLocaleDateString('sv-SE', {timeZone:'Asia/Seoul'}).slice(0,7);
    if (month > currentMonth) return [];
    if (!monthRows.has(month)) monthRows.set(month, fixtureMonths.includes(month) ? createRows(month) : []);
    var alive = new Set();
    var linked = [];
    reports.forEach(function (report) {
      if (!report.id || String(report.date).slice(0,7) !== month || !names.includes(report.owner)) return;
      var id = String(report.id); if (alive.has(id)) return; alive.add(id);
      var source = { owner:report.owner, client:report.client, branch:report.branchName || '지점 미지정', code:String(report.clientCode || ''), type:report.type, product:productGroup(report.product), amount:Number(report.amount || 0), visit:report.date };
      var signature = JSON.stringify(source);
      var cached = reportPlans.get(id);
      if (!cached) { cached = { row:{status:'상담 중',followup:'미정',note:''}, signature:'' }; reportPlans.set(id,cached); }
      if (cached.signature !== signature) { Object.assign(cached.row,source); cached.signature = signature; }
      linked.push(cached.row);
    });
    return linked.concat(monthRows.get(month));
  }
  function node(tag, text, cls) { var n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
  function money(value) { return value.toLocaleString('ko-KR') + '원'; }
  function nav(host) {
    if (!host) return;
    var button = node('button', undefined, 'mobile-tab'); button.type = 'button'; button.dataset.view = 'salesplan';
    var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('width', '18'); icon.setAttribute('height', '18'); icon.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', 'assets/workspace-icons.svg#presentation'); icon.append(use); button.append(icon, node('span', '영업계획서'));
    button.onclick = function () { setActiveView('salesplan', true); render(); }; host.append(button);
  }
  nav(document.querySelector('.mobile-tabs'));
  var desktop = document.querySelector('.desktop-tabs.analytics-nav');
  if (desktop) { var host = node('nav', undefined, 'desktop-tabs plan-nav'); host.setAttribute('aria-label', '영업계획'); desktop.after(host); nav(host); }
  names.forEach(function (name) { var option = node('option', name); option.value = name; el('planOwner').append(option); }); el('planOwner').value = selected;
  function updateSummary() {
    var all = rows().filter(function (r) { return r.owner === selected; });
    var total = all.reduce(function (sum,r) { return sum + (r.status === '제외' ? 0 : r.amount); }, 0);
    var success = all.filter(function (r) { return r.status === '성공'; });
    el('planSummary').replaceChildren();
    [['목표매출', money(2000000)], ['예상매출', money(total)], ['확정매출', money(success.reduce(function (sum,r) { return sum + r.amount; },0))], ['성공률', (all.length ? Math.round(success.length / all.length * 100) : 0) + '%']].forEach(function (metric,i) { var box = node('div',undefined,i === 2 ? 'plan-confirmed' : ''); box.append(node('span',metric[0]),node('strong',metric[1])); el('planSummary').append(box); });
  }
  var columns = [
    {key:'branch',label:'지점'}, {key:'client',label:'거래처명'}, {key:'code',label:'거래처코드'},
    {key:'type',label:'구분',choices:['신규','매출증대']}, {key:'product',label:'목표 품목',choices:productGroups},
    {key:'amount',label:'예상매출 · 만원',type:'number'}, {key:'visit',label:'방문 예정일',type:'date'},
    {key:'status',label:'진행상태',choices:['방문 예정','상담 중','재방문','성공','제외']},
    {key:'followup',label:'후속 처리',choices:['미정','이번 달 재방문','다음 달 이월','제외']}, {key:'note',label:'비고'}
  ];
  function cell(row,column,index,colIndex) {
    var td = node('td',undefined,'plan-cell plan-cell-' + column.key), input = node(column.choices ? 'select' : 'input');
    if (column.choices) column.choices.forEach(function (choice) { var option = node('option',choice); option.value = choice; input.append(option); }); else input.type = column.type || 'text';
    if (column.type === 'number') { input.min = '0'; input.step = '0.0001'; }
    function value() { return column.key === 'amount' ? row.amount / 10000 : column.key === 'visit' ? row.visit || el('planMonth').value + '-' + String(row.day).padStart(2,'0') : row[column.key]; }
    input.value = value(); input.title = String(input.value); input.setAttribute('aria-label',(index+1) + '행 ' + column.label); input.dataset.key = column.key; input.dataset.column = colIndex;
    if (column.key === 'status') input.dataset.status = row.status;
    input.onfocus = function () { if (input.type === 'text' || input.type === 'number') input.select(); };
    function commit() {
      if (!input.checkValidity() || column.type === 'number' && input.value.trim() === '') { input.value = value(); return; }
      row[column.key] = column.key === 'amount' ? Math.round(Number(input.value)*10000) : input.value.trim(); input.title = String(input.value);
      if (column.key === 'status') input.dataset.status = row.status; updateSummary();
    }
    input.onchange = commit;
    input.onkeydown = function (event) {
      if (event.key === 'Escape') { input.value = value(); input.blur(); }
      if (event.key === 'Enter') { event.preventDefault(); commit(); var next = td.parentElement.nextElementSibling; var target = next && next.querySelector('[data-column="'+colIndex+'"]'); if (target) target.focus(); else input.blur(); }
    };
    td.append(input); return td;
  }
  var head = document.querySelector('.plan-table thead tr'); head.replaceChildren(node('th','#')); columns.forEach(function (column) { head.append(node('th',column.label)); });
  function render() {
    var query = el('planSearch').value.trim(); var visible = rows().filter(function (r) { return r.owner === selected && (r.client+r.branch+r.code).includes(query); });
    updateSummary(); el('planCount').textContent = selected + ' · ' + visible.length + '곳'; el('planRows').replaceChildren();
    visible.forEach(function (r,index) { var tr = node('tr'); tr.append(node('th',index+1,'plan-row-number')); columns.forEach(function (column,colIndex) { tr.append(cell(r,column,index,colIndex)); }); el('planRows').append(tr); });
    el('planEmpty').hidden = visible.length > 0;
  }
  el('planOwner').onchange = function () { selected = this.value; render(); }; el('planSearch').oninput = render;
  el('planMonth').onchange = function () { if (!this.value) this.value = '2026-10'; render(); };
  var renderReports = window.render;
  window.render = function () { var result = renderReports.apply(this,arguments); render(); return result; };
  render();
})();
