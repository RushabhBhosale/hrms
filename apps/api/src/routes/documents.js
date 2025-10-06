const router = require("express").Router();
const Employee = require("../models/Employee");
const { auth } = require("../middleware/auth");
const { requirePrimary } = require("../middleware/roles");
const { syncLeaveBalances } = require("../utils/leaveBalances");

const { upload } = require("../utils/uploads");

// Employee: list own documents
router.get("/", auth, async (req, res) => {
  const emp = await Employee.findById(req.employee.id)
    .select("documents")
    .lean();
  res.json({ documents: emp?.documents || [] });
});

// Employee: upload documents
router.post("/", auth, upload.array("documents"), async (req, res) => {
  const docs = (req.files || []).map((f) => f.filename);
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
    const doc = await Employee.findById(req.params.id);
    console.log(":=dshjdsc", doc);
    if (!doc) return res.status(404).json({ error: "Not found" });
    await doc.populate([
      { path: 'reportingPersons', select: 'name' },
      { path: 'reportingPerson', select: 'name' },
    ]);
    await syncLeaveBalances(doc);
    try {
      doc.decryptFieldsSync();
    } catch (_) {}
    const reportingDocs = Array.isArray(doc.reportingPersons)
      ? doc.reportingPersons
      : [];
    const reportingFallback =
      (!reportingDocs || reportingDocs.length === 0) && doc.reportingPerson
        ? [doc.reportingPerson]
        : [];
    const reportingList = [...reportingDocs, ...reportingFallback].reduce(
      (acc, current) => {
        const id = String(current._id);
        if (!acc.some((item) => item.id === id)) {
          acc.push({ id, name: current.name });
        }
        return acc;
      },
      []
    );
    const reporting = reportingList[0] || null;
    res.json({
      employee: {
        id: doc._id,
        name: doc.name,
        email: doc.email,
        dob: doc.dob,
        documents: doc.documents,
        reportingPerson: reporting,
        reportingPersons: reportingList,
        subRoles: doc.subRoles || [],
        address: doc.address || "",
        phone: doc.phone || "",
        personalEmail: doc.personalEmail || "",
        bloodGroup: doc.bloodGroup || "",
        employeeId: doc.employeeId || "",
        ctc: doc.ctc || 0,
        joiningDate: doc.joiningDate,
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
      },
    });
  }
);

module.exports = router;
