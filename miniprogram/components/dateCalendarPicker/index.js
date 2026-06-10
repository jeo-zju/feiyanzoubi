function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function formatYMD(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function todayYMD() {
  const d = new Date();
  return formatYMD(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function clampYMD(v, min, max) {
  if (!isValidYMD(v)) return v;
  const a = isValidYMD(min) ? min : "";
  const b = isValidYMD(max) ? max : "";
  let out = v;
  if (a && out < a) out = a;
  if (b && out > b) out = b;
  return out;
}

function buildYears(minY, maxY) {
  const out = [];
  for (let y = minY; y <= maxY; y++) out.push(String(y));
  return out;
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    value: { type: String, value: "" },
    min: { type: String, value: "" },
    max: { type: String, value: "" }
  },
  data: {
    year: 0,
    month: 0,
    years: [],
    months: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
    yearIndex: 0,
    monthIndex: 0,
    cells: []
  },
  observers: {
    "visible,value,min,max"() {
      if (!this.data.visible) return;
      this.init();
    }
  },
  lifetimes: {
    attached() {
      this.init();
    }
  },
  methods: {
    noop() {},
    onClose() {
      this.triggerEvent("close");
    },
    init() {
      const min = this.properties.min;
      const max = this.properties.max;
      const base = clampYMD(isValidYMD(this.properties.value) ? this.properties.value : todayYMD(), min, max);
      const y = Number(base.slice(0, 4));
      const m = Number(base.slice(5, 7));
      const minY = isValidYMD(min) ? Number(min.slice(0, 4)) : y - 5;
      const maxY = isValidYMD(max) ? Number(max.slice(0, 4)) : y + 5;
      const years = buildYears(Math.max(1970, minY), Math.min(2100, maxY));
      const yearIndex = Math.max(0, years.findIndex((s) => Number(s) === y));
      this.setData(
        {
          year: y,
          month: m,
          years,
          yearIndex: yearIndex >= 0 ? yearIndex : 0,
          monthIndex: Math.max(0, Math.min(11, m - 1))
        },
        () => this.buildCells()
      );
    },
    onPickYear(e) {
      const idx = e && e.detail ? Number(e.detail.value || 0) : 0;
      const year = Number((this.data.years && this.data.years[idx]) || this.data.year);
      this.setData({ year, yearIndex: idx }, () => this.buildCells());
    },
    onPickMonth(e) {
      const idx = e && e.detail ? Number(e.detail.value || 0) : 0;
      const month = Math.max(1, Math.min(12, idx + 1));
      this.setData({ month, monthIndex: idx }, () => this.buildCells());
    },
    buildCells() {
      const year = Number(this.data.year);
      const month = Number(this.data.month);
      if (!year || !month) return;
      const min = isValidYMD(this.properties.min) ? this.properties.min : "";
      const max = isValidYMD(this.properties.max) ? this.properties.max : "";
      const selected = isValidYMD(this.properties.value) ? this.properties.value : "";

      const first = new Date(year, month - 1, 1);
      const firstDay = first.getDay();
      const daysInMonth = new Date(year, month, 0).getDate();
      const total = 42;
      const cells = [];
      for (let i = 0; i < total; i++) {
        const day = i - firstDay + 1;
        if (day <= 0 || day > daysInMonth) {
          cells.push({ key: `${year}-${month}-${i}`, empty: true, day: "", ymd: "", disabled: true, selected: false });
          continue;
        }
        const ymd = formatYMD(year, month, day);
        const disabled = (min && ymd < min) || (max && ymd > max);
        cells.push({
          key: ymd,
          empty: false,
          day: String(day),
          ymd,
          disabled,
          selected: !!(selected && ymd === selected)
        });
      }
      this.setData({ cells });
    },
    onTapDay(e) {
      const ymd = e && e.currentTarget && e.currentTarget.dataset ? String(e.currentTarget.dataset.ymd || "") : "";
      if (!isValidYMD(ymd)) return;
      const min = isValidYMD(this.properties.min) ? this.properties.min : "";
      const max = isValidYMD(this.properties.max) ? this.properties.max : "";
      if ((min && ymd < min) || (max && ymd > max)) return;
      this.triggerEvent("change", { value: ymd });
      this.triggerEvent("close");
    }
  }
});

