const router = require("express").Router();
const Employee = require("../models/Employee");
const { auth } = require("../middleware/auth");
const { requirePrimary } = require("../middleware/roles");
const { syncLeaveBalances } = require("../utils/leaveBalances");

const { upload, getStoredFileId } = require("../utils/fileStorage");

// Employee: list own documents
router.get("/", auth, async (req, res) => {
  const emp = await Employee.findById(req.employee.id)
    .select("documents")
    .lean();
  res.json({ documents: emp?.documents || [] });
});

// Employee: upload documents
router.post("/", auth, upload.array("documents"), async (req, res) => {
  const docs = (req.files || [])
    .map((f) => getStoredFileId(f))
    .filter(Boolean);
  const emp = await Employee.findByIdAndUpdate(
    req.employee.id,
    { $push: { documents: { $each: docs } } },
    { new: true }
  ).select("documents");
  res.json({ documents: emp.documents });
});

// Admin: view documents of an employee
router.get(
  "/:id",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    const doc = await Employee.findById(req.params.id)
      .populate([
        { path: "reportingPerson", select: "name" },
        { path: "reportingPersons", select: "name" },
      ]);
    if (!doc) return res.status(404).json({ error: "Not found" });
    await syncLeaveBalances(doc);
    try {
      doc.decryptFieldsSync();
    } catch (_) {}
    const reportingList = Array.isArray(doc.reportingPersons)
      ? doc.reportingPersons.map((rp) => ({
          id: String(rp._id || rp),
          name: rp.name || "",
        }))
      : [];
    const reportingPrimary = reportingList[0]
      ? reportingList[0]
      : doc.reportingPerson
      ? {
          id: String(doc.reportingPerson._id || doc.reportingPerson),
          name: doc.reportingPerson.name || "",
        }
      : null;
    res.json({
      employee: {
        id: doc._id,
        name: doc.name,
        email: doc.email,
        isDeleted: !!doc.isDeleted,
        isActive: doc.isActive !== false,
        profileImage: doc.profileImage || null,
        dob: doc.dob,
        documents: doc.documents,
        reportingPerson: reportingPrimary,
        reportingPersons: reportingList,
        subRoles: doc.subRoles || [],
        address: doc.address || "",
        phone: doc.phone || "",
        personalEmail: doc.personalEmail || "",
        bloodGroup: doc.bloodGroup || "",
        employeeId: doc.employeeId || "",
        ctc: doc.ctc || 0,
        joiningDate: doc.joiningDate,
        attendanceStartDate: doc.attendanceStartDate || doc.joiningDate || null,
        totalLeaveAvailable: doc.totalLeaveAvailable || 0,
        leaveBalances: {
          paid: doc.leaveBalances?.paid || 0,
          casual: doc.leaveBalances?.casual || 0,
          sick: doc.leaveBalances?.sick || 0,
          unpaid: doc.leaveBalances?.unpaid || 0,
        },
        aadharNumber: doc.aadharNumber || "",
        panNumber: doc.panNumber || "",
        bankDetails: {
          accountNumber: doc.bankDetails?.accountNumber || "",
          bankName: doc.bankDetails?.bankName || "",
          ifsc: doc.bankDetails?.ifsc || "",
        },
        uan: doc.uan || "",
        employmentStatus: doc.employmentStatus || "PROBATION",
        probationSince: doc.probationSince || null,
        hasTds: !!doc.hasTds,
        offboarding: doc.offboarding
          ? {
              lastWorkingDay: doc.offboarding.lastWorkingDay,
              reason: doc.offboarding.reason || "other",
              note: doc.offboarding.note || "",
              recordedBy: doc.offboarding.recordedBy || null,
              recordedAt: doc.offboarding.recordedAt || null,
            }
          : null,
      },
    });
  }
);

// Admin: upload documents for an employee
router.post(
  "/:id",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  upload.array("documents"),
  async (req, res) => {
    const { id } = req.params;
    const docs = (req.files || [])
      .map((f) => getStoredFileId(f))
      .filter(Boolean);
    const emp = await Employee.findByIdAndUpdate(
      id,
      { $push: { documents: { $each: docs } } },
      { new: true }
    ).select("documents");
    if (!emp) return res.status(404).json({ error: "Not found" });
    res.set("X-Success-Message", "Documents uploaded");
    res.json({ documents: emp.documents });
  }
);

module.exports = router;
