const { announcementSchema } = require("./announcement");
const { attendanceSchema } = require("./attendance");
const { attendanceOverrideSchema } = require("./attendanceOverride");
const { companySchema } = require("./company");
const { companyDayOverrideSchema } = require("./companyDayOverride");
const { companyTypeMasterSchema } = require("./companyTypeMaster");
const { counterSchema } = require("./counter");
const { employeeSchema } = require("./employee");
const { expenseSchema } = require("./expense");
const { expenseCategorySchema } = require("./expenseCategory");
const { invoiceSchema } = require("./invoice");
const { leaveSchema } = require("./leave");
const { masterCitySchema } = require("./masterCity");
const { masterCountrySchema } = require("./masterCountry");
const { masterStateSchema } = require("./masterState");
const { projectSchema } = require("./project");
const { salarySlipSchema } = require("./salarySlip");
const { salaryTemplateSchema } = require("./salaryTemplate");
const { taskSchema } = require("./task");

module.exports = {
  announcementSchema,
  attendanceSchema,
  attendanceOverrideSchema,
  companySchema,
  companyDayOverrideSchema,
  companyTypeMasterSchema,
  counterSchema,
  employeeSchema,
  expenseSchema,
  expenseCategorySchema,
  invoiceSchema,
  leaveSchema,
  masterCitySchema,
  masterCountrySchema,
  masterStateSchema,
  projectSchema,
  salarySlipSchema,
  salaryTemplateSchema,
  taskSchema,
};
