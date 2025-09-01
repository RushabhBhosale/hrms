const router = require("express").Router();
const multer = require("multer");
const path = require("path");
const Employee = require("../models/Employee");
const { auth } = require("../middleware/auth");
const { requirePrimary } = require("../middleware/roles");

const upload = multer({ dest: path.join(__dirname, "../../uploads") });

// Employee: list own documents
router.get("/", auth, async (req, res) => {
  const emp = await Employee.findById(req.employee.id).select("documents").lean();
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
    const emp = await Employee.findById(req.params.id)
      .select(
        "name email dob documents reportingPerson subRoles address phone employeeId ctc aadharNumber panNumber bankDetails"
      )
      .populate("reportingPerson", "name")
      .lean();
    if (!emp) return res.status(404).json({ error: "Not found" });
    res.json({
      employee: {
        id: emp._id,
        name: emp.name,
        email: emp.email,
        dob: emp.dob,
        documents: emp.documents,
        reportingPerson: emp.reportingPerson
          ? { id: emp.reportingPerson._id, name: emp.reportingPerson.name }
          : null,
        subRoles: emp.subRoles || [],
        address: emp.address || "",
        phone: emp.phone || "",
        employeeId: emp.employeeId || "",
        ctc: emp.ctc || 0,
        aadharNumber: emp.aadharNumber || "",
        panNumber: emp.panNumber || "",
        bankDetails: {
          accountNumber: emp.bankDetails?.accountNumber || "",
          bankName: emp.bankDetails?.bankName || "",
          ifsc: emp.bankDetails?.ifsc || "",
        },
      },
    });
  }
);

module.exports = router;
