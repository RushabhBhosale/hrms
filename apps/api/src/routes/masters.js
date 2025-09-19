const router = require("express").Router();
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const multer = require("multer");

const { auth } = require("../middleware/auth");
const { requirePrimary } = require("../middleware/roles");
const MasterCountry = require("../models/MasterCountry");
const MasterState = require("../models/MasterState");
const MasterCity = require("../models/MasterCity");
const CompanyTypeMaster = require("../models/CompanyTypeMaster");

const upload = multer({ dest: path.join(__dirname, "../../uploads") });

function slug(value) {
  if (!value) return "";
  return String(value).trim().toLowerCase();
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (value.text) return String(value.text).trim();
    if (Array.isArray(value.richText))
      return value.richText.map((part) => part.text).join("").trim();
    if (Object.prototype.hasOwnProperty.call(value, "result"))
      return cellText(value.result);
    if (Object.prototype.hasOwnProperty.call(value, "hyperlink")) {
      if (value.text) return String(value.text).trim();
      if (value.result) return cellText(value.result);
    }
  }
  return String(value).trim();
}

function sanitizeHeader(value) {
  const text = cellText(value);
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseSheet(sheet, fieldMap, requiredFields = []) {
  if (!sheet)
    return { present: false, rows: [], missingFields: [], fieldsSeen: [] };
  const headerRow = sheet.getRow(1);
  const columns = new Map();
  const fieldsSeen = new Set();

  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const key = sanitizeHeader(cell.value);
    if (!key) return;
    const canonical = fieldMap[key];
    if (!canonical) return;
    columns.set(colNumber, canonical);
    fieldsSeen.add(canonical);
  });

  const missingFields = requiredFields.filter((field) => !fieldsSeen.has(field));
  const rows = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = {};
    let hasValue = false;
    columns.forEach((field, colNumber) => {
      const value = cellText(row.getCell(colNumber).value);
      if (value !== "") hasValue = true;
      record[field] = value;
    });
    if (hasValue) rows.push({ rowNumber, values: record });
  });

  return {
    present: true,
    rows,
    missingFields,
    fieldsSeen: Array.from(fieldsSeen),
  };
}

async function buildSummary() {
  const [countries, states, cities, companyTypes, lastCountry, lastState, lastCity, lastCompanyType] =
    await Promise.all([
      MasterCountry.countDocuments(),
      MasterState.countDocuments(),
      MasterCity.countDocuments(),
      CompanyTypeMaster.countDocuments(),
      MasterCountry.findOne().sort({ updatedAt: -1 }).lean(),
      MasterState.findOne().sort({ updatedAt: -1 }).lean(),
      MasterCity.findOne().sort({ updatedAt: -1 }).lean(),
      CompanyTypeMaster.findOne().sort({ updatedAt: -1 }).lean(),
    ]);

  const toMeta = (count, doc) => ({
    count,
    lastUpdatedAt: doc ? doc.updatedAt : null,
  });

  return {
    countries: toMeta(countries, lastCountry),
    states: toMeta(states, lastState),
    cities: toMeta(cities, lastCity),
    companyTypes: toMeta(companyTypes, lastCompanyType),
  };
}

router.get(
  "/summary",
  auth,
  requirePrimary(["SUPERADMIN"]),
  async (req, res) => {
    try {
      const summary = await buildSummary();
      res.json({ summary });
    } catch (err) {
      console.error("masters summary err", err);
      res.status(500).json({ error: "Failed to load master summary" });
    }
  }
);

router.post(
  "/import",
  auth,
  requirePrimary(["SUPERADMIN"]),
  upload.single("file"),
  async (req, res) => {
    const filePath = req.file?.path;
    if (!req.file) {
      return res.status(400).json({
        error: "Please upload an Excel file with the masters data.",
      });
    }

    const ext = path.extname(req.file.originalname || "").toLowerCase();
    if (ext !== ".xlsx") {
      if (filePath)
        fs.promises.unlink(filePath).catch(() => {});
      return res.status(400).json({
        error: "Unsupported file. Please upload a .xlsx workbook.",
      });
    }

    const result = {
      countries: { inserted: 0, updated: 0, skipped: 0 },
      states: { inserted: 0, updated: 0, skipped: 0 },
      cities: { inserted: 0, updated: 0, skipped: 0 },
      companyTypes: { inserted: 0, updated: 0, skipped: 0 },
    };
    const warnings = [];

    const addWarning = (sheet, rowNumber, message) => {
      warnings.push({ sheet, rowNumber, message });
    };

    const markSkipped = (section, rowNumber, message) => {
      if (result[section]) result[section].skipped += 1;
      addWarning(section, rowNumber, message);
    };

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      const normalizeSheetName = (value) =>
        value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

      const getSheet = (name) => {
        const target = normalizeSheetName(name);
        return (
          workbook.worksheets.find(
            (ws) => normalizeSheetName(ws.name) === target
          ) || null
        );
      };

      const fieldMaps = {
        countries: {
          name: "name",
          country: "name",
          country_name: "name",
          iso_code: "isoCode",
          iso: "isoCode",
          isocode: "isoCode",
          phone: "phoneCode",
          phone_code: "phoneCode",
          phonecode: "phoneCode",
          dial_code: "phoneCode",
          dialcode: "phoneCode",
        },
        states: {
          name: "name",
          state: "name",
          state_name: "name",
          country: "country",
          country_name: "country",
          countrycode: "country",
          iso_code: "isoCode",
          iso: "isoCode",
          isocode: "isoCode",
        },
        cities: {
          name: "name",
          city: "name",
          city_name: "name",
          state: "state",
          state_name: "state",
          country: "country",
          country_name: "country",
        },
        companyTypes: {
          name: "name",
          type: "name",
          company_type: "name",
          companytype: "name",
          description: "description",
          details: "description",
        },
      };

      const countriesSheet = getSheet("countries");
      const statesSheet = getSheet("states");
      const citiesSheet = getSheet("cities");
      const companyTypesSheet = getSheet("companytypes");

      const parsedCountries = parseSheet(
        countriesSheet,
        fieldMaps.countries,
        ["name"]
      );
      const parsedStates = parseSheet(
        statesSheet,
        fieldMaps.states,
        ["name", "country"]
      );
      const parsedCities = parseSheet(
        citiesSheet,
        fieldMaps.cities,
        ["name", "state", "country"]
      );
      const parsedCompanyTypes = parseSheet(
        companyTypesSheet,
        fieldMaps.companyTypes,
        ["name"]
      );

      const formatIssues = [];
      if (parsedCountries.present && parsedCountries.missingFields.length) {
        formatIssues.push(
          `Countries sheet is missing columns: ${parsedCountries.missingFields.join(", ")}`
        );
      }
      if (parsedStates.present && parsedStates.missingFields.length) {
        formatIssues.push(
          `States sheet is missing columns: ${parsedStates.missingFields.join(", ")}`
        );
      }
      if (parsedCities.present && parsedCities.missingFields.length) {
        formatIssues.push(
          `Cities sheet is missing columns: ${parsedCities.missingFields.join(", ")}`
        );
      }
      if (
        parsedCompanyTypes.present &&
        parsedCompanyTypes.missingFields.length
      ) {
        formatIssues.push(
          `CompanyTypes sheet is missing columns: ${parsedCompanyTypes.missingFields.join(", ")}`
        );
      }

      if (formatIssues.length) {
        return res.status(400).json({
          error: "Excel format is missing required columns.",
          details: formatIssues,
        });
      }

      // Countries
      if (parsedCountries.rows.length) {
        const seen = new Set();
        const operations = [];
        parsedCountries.rows.forEach(({ rowNumber, values }) => {
          const name = values.name?.trim();
          if (!name) {
            markSkipped("countries", rowNumber, "Country name is required.");
            return;
          }
          const nameKey = slug(name);
          if (!nameKey) {
            markSkipped("countries", rowNumber, "Country name is required.");
            return;
          }
          if (seen.has(nameKey)) {
            markSkipped(
              "countries",
              rowNumber,
              `Duplicate country '${name}' in uploaded file.`
            );
            return;
          }
          seen.add(nameKey);
          const isoCode = values.isoCode ? values.isoCode.trim().toUpperCase() : "";
          const phoneCode = values.phoneCode ? values.phoneCode.trim() : "";
          operations.push({
            name,
            nameKey,
            isoCode,
            phoneCode,
          });
        });

        if (operations.length) {
          const bulk = operations.map((entry) => ({
            updateOne: {
              filter: { nameKey: entry.nameKey },
              update: {
                $set: {
                  name: entry.name,
                  nameKey: entry.nameKey,
                  isoCode: entry.isoCode || null,
                  phoneCode: entry.phoneCode || null,
                  updatedBy: req.employee.id,
                },
                $setOnInsert: { createdBy: req.employee.id },
              },
              upsert: true,
            },
          }));
          const writeRes = await MasterCountry.bulkWrite(bulk, {
            ordered: false,
          });
          result.countries.inserted += writeRes.upsertedCount || 0;
          result.countries.updated += writeRes.matchedCount || 0;
        }
      }

      // States
      if (parsedStates.rows.length) {
        const seen = new Set();
        const countryKeys = new Set();
        parsedStates.rows.forEach(({ values }) => {
          const countryKey = slug(values.country);
          if (countryKey) countryKeys.add(countryKey);
        });

        const countries = countryKeys.size
          ? await MasterCountry.find({ nameKey: { $in: Array.from(countryKeys) } })
              .lean()
          : [];
        const countryMap = new Map(
          countries.map((doc) => [doc.nameKey, doc])
        );

        const operations = [];
        parsedStates.rows.forEach(({ rowNumber, values }) => {
          const name = values.name?.trim();
          const countryName = values.country?.trim();
          if (!name || !countryName) {
            markSkipped(
              "states",
              rowNumber,
              "State and country are required."
            );
            return;
          }
          const stateNameKey = slug(name);
          const countryKey = slug(countryName);
          if (!stateNameKey || !countryKey) {
            markSkipped(
              "states",
              rowNumber,
              "State and country are required."
            );
            return;
          }
          const compositeKey = `${stateNameKey}::${countryKey}`;
          if (seen.has(compositeKey)) {
            markSkipped(
              "states",
              rowNumber,
              `Duplicate state '${name}' for country '${countryName}' in uploaded file.`
            );
            return;
          }
          const countryDoc = countryMap.get(countryKey);
          if (!countryDoc) {
            markSkipped(
              "states",
              rowNumber,
              `Country '${countryName}' not found. Add it in the Countries sheet first.`
            );
            return;
          }
          seen.add(compositeKey);
          const isoCode = values.isoCode ? values.isoCode.trim().toUpperCase() : "";
          operations.push({
            name,
            nameKey: stateNameKey,
            stateKey: compositeKey,
            countryKey,
            countryName: countryDoc.name,
            countryId: countryDoc._id,
            isoCode,
          });
        });

        if (operations.length) {
          const bulk = operations.map((entry) => ({
            updateOne: {
              filter: { stateKey: entry.stateKey },
              update: {
                $set: {
                  name: entry.name,
                  nameKey: entry.nameKey,
                  stateKey: entry.stateKey,
                  countryKey: entry.countryKey,
                  countryName: entry.countryName,
                  country: entry.countryId,
                  isoCode: entry.isoCode || null,
                  updatedBy: req.employee.id,
                },
                $setOnInsert: { createdBy: req.employee.id },
              },
              upsert: true,
            },
          }));
          const writeRes = await MasterState.bulkWrite(bulk, { ordered: false });
          result.states.inserted += writeRes.upsertedCount || 0;
          result.states.updated += writeRes.matchedCount || 0;
        }
      }

      // Cities
      if (parsedCities.rows.length) {
        const seen = new Set();
        const stateKeys = new Set();
        parsedCities.rows.forEach(({ values }) => {
          const stateSlug = slug(values.state);
          const countrySlug = slug(values.country);
          if (stateSlug && countrySlug) {
            stateKeys.add(`${stateSlug}::${countrySlug}`);
          }
        });

        const states = stateKeys.size
          ? await MasterState.find({ stateKey: { $in: Array.from(stateKeys) } })
              .lean()
          : [];
        const stateMap = new Map(states.map((doc) => [doc.stateKey, doc]));

        const operations = [];
        parsedCities.rows.forEach(({ rowNumber, values }) => {
          const name = values.name?.trim();
          const stateName = values.state?.trim();
          const countryName = values.country?.trim();
          if (!name || !stateName || !countryName) {
            markSkipped(
              "cities",
              rowNumber,
              "City, state, and country are required."
            );
            return;
          }
          const cityNameKey = slug(name);
          const stateSlug = slug(stateName);
          const countrySlug = slug(countryName);
          const stateKey = `${stateSlug}::${countrySlug}`;
          if (!cityNameKey || !stateSlug || !countrySlug) {
            markSkipped(
              "cities",
              rowNumber,
              "City, state, and country are required."
            );
            return;
          }
          const compositeKey = `${cityNameKey}::${stateKey}`;
          if (seen.has(compositeKey)) {
            markSkipped(
              "cities",
              rowNumber,
              `Duplicate city '${name}' for state '${stateName}' in uploaded file.`
            );
            return;
          }
          const stateDoc = stateMap.get(stateKey);
          if (!stateDoc) {
            markSkipped(
              "cities",
              rowNumber,
              `State '${stateName}' for country '${countryName}' not found. Ensure it exists in the States sheet.`
            );
            return;
          }
          seen.add(compositeKey);
          operations.push({
            name,
            nameKey: cityNameKey,
            cityKey: compositeKey,
            stateKey,
            stateId: stateDoc._id,
            stateName: stateDoc.name,
            countryId: stateDoc.country,
            countryKey: stateDoc.countryKey,
            countryName: stateDoc.countryName,
          });
        });

        if (operations.length) {
          const bulk = operations.map((entry) => ({
            updateOne: {
              filter: { cityKey: entry.cityKey },
              update: {
                $set: {
                  name: entry.name,
                  nameKey: entry.nameKey,
                  cityKey: entry.cityKey,
                  stateKey: entry.stateKey,
                  stateName: entry.stateName,
                  state: entry.stateId,
                  countryKey: entry.countryKey,
                  countryName: entry.countryName,
                  country: entry.countryId,
                  updatedBy: req.employee.id,
                },
                $setOnInsert: { createdBy: req.employee.id },
              },
              upsert: true,
            },
          }));
          const writeRes = await MasterCity.bulkWrite(bulk, { ordered: false });
          result.cities.inserted += writeRes.upsertedCount || 0;
          result.cities.updated += writeRes.matchedCount || 0;
        }
      }

      // Company types
      if (parsedCompanyTypes.rows.length) {
        const seen = new Set();
        const operations = [];
        parsedCompanyTypes.rows.forEach(({ rowNumber, values }) => {
          const name = values.name?.trim();
          if (!name) {
            markSkipped(
              "companyTypes",
              rowNumber,
              "Company type name is required."
            );
            return;
          }
          const nameKey = slug(name);
          if (!nameKey) {
            markSkipped(
              "companyTypes",
              rowNumber,
              "Company type name is required."
            );
            return;
          }
          if (seen.has(nameKey)) {
            markSkipped(
              "companyTypes",
              rowNumber,
              `Duplicate company type '${name}' in uploaded file.`
            );
            return;
          }
          seen.add(nameKey);
          const description = values.description ? values.description.trim() : "";
          operations.push({ name, nameKey, description });
        });

        if (operations.length) {
          const bulk = operations.map((entry) => ({
            updateOne: {
              filter: { nameKey: entry.nameKey },
              update: {
                $set: {
                  name: entry.name,
                  nameKey: entry.nameKey,
                  description: entry.description || null,
                  updatedBy: req.employee.id,
                },
                $setOnInsert: { createdBy: req.employee.id },
              },
              upsert: true,
            },
          }));
          const writeRes = await CompanyTypeMaster.bulkWrite(bulk, {
            ordered: false,
          });
          result.companyTypes.inserted += writeRes.upsertedCount || 0;
          result.companyTypes.updated += writeRes.matchedCount || 0;
        }
      }

      const summary = await buildSummary();
      res.json({
        message: "Master data imported successfully.",
        result,
        warnings,
        summary,
      });
    } catch (err) {
      console.error("masters import err", err);
      res.status(500).json({ error: "Failed to import master data." });
    } finally {
      if (filePath) fs.promises.unlink(filePath).catch(() => {});
    }
  }
);

module.exports = router;
