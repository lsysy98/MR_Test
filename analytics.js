var performanceGrouping = 'owner';

function performanceGroups(items, grouping) {
  var groups = new Map();
  if (grouping === 'owner') ownerNames.forEach(function(owner) { groups.set(owner, []); });
  items.forEach(function(item) {
    var name = grouping === 'owner' ? item.owner : (String(item.branchName || '').trim() || '지점 미지정');
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  });
  return Array.from(groups, function(entry) { return { name: entry[0], summary: summarize(entry[1]) }; })
    .sort(function(a, b) { return b.summary.new.count - a.summary.new.count || b.summary.new.amount - a.summary.new.amount || a.name.localeCompare(b.name, 'ko'); });
}

function renderPerformanceAnalysis() {
  var panel = document.getElementById('analyticsPanel');
  if (!panel || !document.body.classList.contains('view-analytics')) return;
  var month = selectedYear + '-' + String(selectedMonth).padStart(2, '0');
  document.getElementById('analyticsMonth').value = month;
  document.getElementById('analyticsMonthLabel').textContent = selectedYear + '. ' + String(selectedMonth).padStart(2, '0');
  document.getElementById('analyticsGroupTitle').textContent = performanceGrouping === 'owner' ? '담당자' : '지점';
  document.getElementById('analyticsCaption').textContent = month + ' 통계 수거 월 기준 ' + (performanceGrouping === 'owner' ? '개인별' : '지점별') + ' 실적';
  var items = monthlyItems();
  var body = document.getElementById('analyticsRows');
  var total = document.getElementById('analyticsTotal');
  body.replaceChildren();
  total.replaceChildren();
  function addRow(parent, name, summary) {
    var row = document.createElement('tr');
    var label = document.createElement('th');
    label.scope = 'row';
    label.textContent = name;
    row.appendChild(label);
    [summary.new.count + '건', won(summary.new.amount), summary.growth.count + '건', won(summary.growth.amount), summary.total.count + '건', won(summary.total.amount)].forEach(function(value) {
      var cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });
    parent.appendChild(row);
  }
  performanceGroups(items, performanceGrouping).forEach(function(group) { addRow(body, group.name, group.summary); });
  addRow(total, '합계', summarize(items));
  document.getElementById('analyticsEmpty').hidden = items.length > 0;
}

(function () {
  viewNames.push('analytics');
  document.getElementById('menuAnalyticsBtn').addEventListener('click', function() {
    closeAdminMenu();
    setActiveView('analytics', true);
    renderPerformanceAnalysis();
  });
  document.querySelectorAll('[data-analytics-group]').forEach(function(button) {
    button.addEventListener('click', function() {
      performanceGrouping = button.dataset.analyticsGroup;
      document.querySelectorAll('[data-analytics-group]').forEach(function(option) {
        var selected = option === button;
        option.classList.toggle('active', selected);
        option.setAttribute('aria-pressed', String(selected));
      });
      renderPerformanceAnalysis();
    });
  });
  document.getElementById('analyticsPrevMonth').addEventListener('click', function() { moveMonth(-1); });
  document.getElementById('analyticsNextMonth').addEventListener('click', function() { moveMonth(1); });
  document.getElementById('analyticsMonthLabel').addEventListener('click', function() { openMonthPicker(document.getElementById('analyticsMonth')); });
  document.getElementById('analyticsMonth').addEventListener('change', function(event) { setSelectedMonthFromValue(event.target.value); });
})();
