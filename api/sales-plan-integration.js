function buildSalesPlanPayload(action, report, updatedAt) {
  const reportId = String(report.id || report.reportId || "");
  const eventUpdatedAt = Number(updatedAt || report.updatedAt || Date.now());

  if (action === "delete") {
    return {
      dataType: "daily_report",
      action: "delete",
      reportId,
      deleted: true,
      updatedAt: eventUpdatedAt
    };
  }

  return {
    dataType: "daily_report",
    action: "create_or_update",
    reportId,
    owner: report.owner || "",
    date: report.date || "",
    clientName: report.client || report.clientName || "",
    clientCode: String(report.clientCode || ""),
    type: report.type || "",
    product: report.product || "",
    amount: Number(report.amount || 0),
    branchName: report.branchName || "",
    collectionMonth: report.collectionMonth || "",
    updatedAt: eventUpdatedAt
  };
}

function hasSalesPlanConfig() {
  return false;
}

async function notifyDailyReportChange() {
  return { ok: true, skipped: "disabled_in_test" };
}

async function retryPendingSalesPlanEvents() {
  return { attempted: 0, delivered: 0, failed: 0, skipped: "disabled_in_test" };
}

module.exports = {
  buildSalesPlanPayload,
  hasSalesPlanConfig,
  notifyDailyReportChange,
  retryPendingSalesPlanEvents
};
