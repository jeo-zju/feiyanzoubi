const { ensureAppLogin, syncAppLogin } = require("../../utils/session");
const { safeText } = require("../../utils/format");
const userApi = require("../../services/api/user");
const cardApi = require("../../services/api/card");
const cache = require("../../utils/cache");
const { collection } = require("../../services/db");

// issue #13: 预置攀岩黑话库（随机 emoji 按钮从中取）
const SLOGAN_POOL = [
  "攀岩是我唯一的温柔",
  "挂上快挂，烦恼放下",
  "这条线，我势在必得",
  "疼吗？疼就对了",
  "岩壁不会辜负努力",
  "今天就爬开心点",
  "不掉下来就行",
  "稳一点，再稳一点",
  "指尖的信仰",
  "摔过的地方都开过花",
  "向上是唯一的答案",
  "粉袋一背，谁也不爱"
];

const SLOGAN_EMOJIS = ["🧗", "🪨", "🧗‍♀️", "🧗‍♂️", "💪", "🔥", "✨", "🦾", "⛰️", "🎯", "🤙", "🧊"];

const BOULDER_LEVELS = ["", "V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8+"];
const ROPE_LEVELS = ["", "5.8", "5.9", "5.10a", "5.10b", "5.10c", "5.10d", "5.11a", "5.11b", "5.11c", "5.11d", "5.12a+"];
const CITIES = ["北京", "上海", "广州", "深圳", "杭州", "成都", "重庆", "武汉", "南京", "苏州", "西安", "长沙", "青岛", "厦门", "天津"];
const TITLE_OPTIONS = [
  "",
  "长臂猿",
  "理论攀岩者",
  "小短手",
  "小短腿",
  "脚点哲学家",
  "热身冠军",
  "落点收藏家",
  "复盘型选手",
  "保护点强迫症",
  "岩点谈判专家",
  "只会横移的",
  "观众席 MVP"
];
const MBTI_OPTIONS = ["", "INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"];

function fileExt(path) {
  const v = safeText(path);
  const m = v.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return m ? m[1].toLowerCase() : "png";
}
function isRemoteAvatar(path) {
  const v = safeText(path);
  if (/^cloud:\/\//.test(v)) return true;
  // 微信 chooseAvatar 返回的本地临时路径（http://tmp/... 或 wxfile://...），不是远程地址
  if (/^wxfile:\/\//.test(v) || /^http:\/\/tmp\//.test(v)) return false;
  return /^https?:\/\//.test(v);
}
function indexOf(arr, val) {
  for (let i = 0; i < arr.length; i++) if (arr[i] === val) return i;
  return -1;
}

Page({
  data: {
    defaultAvatar: "/images/avatar.png",
    form: {
      nickName: "",
      avatarUrl: ""
    },
    displayName: "",
    title: "",
    mbti: "",
    slogan: "",
    hasLocalAvatar: false,
    saving: false,
    climbSkills: {
      boulder: "",
      toprope: "",
      lead: ""
    },
    city: "",
    heightCm: "",
    armspanCm: "",
    boulderLevels: BOULDER_LEVELS,
    ropeLevels: ROPE_LEVELS,
    cities: CITIES,
    titleOptions: TITLE_OPTIONS,
    mbtiOptions: MBTI_OPTIONS,
    boulderIdx: 0,
    topropeIdx: 0,
    leadIdx: 0,
    cityIdx: 0,
    titleIdx: 0,
    mbtiIdx: 0
  },

  onShow() {
    this.loadUser();
  },

  async loadUser() {
    try {
      const user = await ensureAppLogin();
      let me = {};
      try {
        const r = await userApi.getMe();
        me = (r && r.me) || {};
      } catch (e) {}
      const cs = (me && me.climbSkills) || user.climbSkills || {};
      const city = (me && me.city) || user.city || "";
      const displayName = safeText(me.displayName || "");
      const title = safeText(me.title || "");
      const mbti = safeText(me.mbti || "");
      const slogan = safeText(me.slogan || "");
      this.setData({
        form: {
          nickName: safeText(me.nickName || user && user.nickName),
          avatarUrl: safeText(me.avatarUrl || user && user.avatarUrl)
        },
        displayName,
        title,
        mbti,
        slogan,
        hasLocalAvatar: false,
        climbSkills: {
          boulder: safeText(cs.boulder || ""),
          toprope: safeText(cs.toprope || ""),
          lead: safeText(cs.lead || "")
        },
        city: safeText(city || ""),
        heightCm: safeText(me.heightCm || me.height || user && user.heightCm || user && user.height || ""),
        armspanCm: safeText(me.armspanCm || me.armspan || user && user.armspanCm || user && user.armspan || ""),
        boulderIdx: Math.max(0, indexOf(BOULDER_LEVELS, safeText(cs.boulder || ""))),
        topropeIdx: Math.max(0, indexOf(ROPE_LEVELS, safeText(cs.toprope || ""))),
        leadIdx: Math.max(0, indexOf(ROPE_LEVELS, safeText(cs.lead || ""))),
        cityIdx: Math.max(0, indexOf(CITIES, safeText(city || ""))),
        titleIdx: Math.max(0, indexOf(TITLE_OPTIONS, title)),
        mbtiIdx: Math.max(0, indexOf(MBTI_OPTIONS, mbti))
      });
    } catch (e) {
      wx.showToast({ title: "登录失败", icon: "none" });
    }
  },

  onNickNameInput(e) {
    this.setData({ "form.nickName": e && e.detail ? e.detail.value : "" });
  },
  onDisplayNameInput(e) {
    this.setData({ displayName: e && e.detail ? e.detail.value : "" });
  },

  // issue #13: 名片一句话编辑
  onSloganInput(e) {
    this.setData({ slogan: (e && e.detail && e.detail.value || "").slice(0, 20) });
  },
  onRandomSlogan() {
    const idx = Math.floor(Math.random() * SLOGAN_POOL.length);
    const emoji = SLOGAN_EMOJIS[Math.floor(Math.random() * SLOGAN_EMOJIS.length)];
    this.setData({ slogan: `${emoji} ${SLOGAN_POOL[idx]}` });
  },
  // issue #13: 手填的新话写入黑话临时库（user_added 标记，默认不展示给其他用户）
  async submitSloganToPool(text) {
    try {
      const pool = collection("RockSloganPool");
      const where = pool.where({ text });
      const found = await where.count();
      if (found && found.total > 0) return;
      await pool.add({
        data: {
          text,
          user_added: true,
          source: "user",
          approved: false,
          createdAt: Date.now()
        }
      });
    } catch (e) {
      console.warn("[profile-edit] submitSloganToPool failed", e && e.message);
    }
  },

  onChooseAvatar(e) {
    const avatarUrl = safeText(e && e.detail && e.detail.avatarUrl);
    if (!avatarUrl) return;
    this.setData({ "form.avatarUrl": avatarUrl, hasLocalAvatar: !isRemoteAvatar(avatarUrl) });
  },

  async uploadAvatar(tempPath) {
    // issue #10: 增加重试；cloudPath 用时间戳+随机+扩展名保证唯一
    console.warn("[profile-edit] uploadAvatar start", tempPath && tempPath.slice(0, 80));
    const doUpload = () => new Promise((resolve, reject) => {
      const ext = fileExt(tempPath);
      const cloudPath = `avatars/${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
      wx.cloud.uploadFile({
        cloudPath,
        filePath: tempPath,
        success: (res) => {
          console.warn("[profile-edit] uploadAvatar success", res && res.fileID);
          resolve(res && res.fileID ? res.fileID : "");
        },
        fail: (err) => {
          console.warn("[profile-edit] uploadAvatar fail", err && err.errMsg, err && err.message);
          reject(err);
        }
      });
    });
    try {
      return await doUpload();
    } catch (e1) {
      try { await new Promise((r) => setTimeout(r, 600)); } catch (_) {}
      return await doUpload();
    }
  },

  onBoulderChange(e) {
    const idx = Number((e && e.detail && e.detail.value) || 0);
    this.setData({ boulderIdx: idx, "climbSkills.boulder": BOULDER_LEVELS[idx] || "" });
  },
  onTopropeChange(e) {
    const idx = Number((e && e.detail && e.detail.value) || 0);
    this.setData({ topropeIdx: idx, "climbSkills.toprope": ROPE_LEVELS[idx] || "" });
  },
  onLeadChange(e) {
    const idx = Number((e && e.detail && e.detail.value) || 0);
    this.setData({ leadIdx: idx, "climbSkills.lead": ROPE_LEVELS[idx] || "" });
  },
  onCityChange(e) {
    const idx = Number((e && e.detail && e.detail.value) || 0);
    this.setData({ cityIdx: idx, city: CITIES[idx] || "" });
  },
  onTitleChange(e) {
    const idx = Number((e && e.detail && e.detail.value) || 0);
    this.setData({ titleIdx: idx, title: TITLE_OPTIONS[idx] || "" });
  },
  onMbtiChange(e) {
    const idx = Number((e && e.detail && e.detail.value) || 0);
    this.setData({ mbtiIdx: idx, mbti: MBTI_OPTIONS[idx] || "" });
  },
  onHeightInput(e) {
    this.setData({ heightCm: (e && e.detail && e.detail.value || "").replace(/\D/g, "").slice(0, 3) });
  },
  onArmspanInput(e) {
    this.setData({ armspanCm: (e && e.detail && e.detail.value || "").replace(/\D/g, "").slice(0, 3) });
  },

  async onSave() {
    if (this.data.saving) return;
    const nickName = safeText(this.data.form && this.data.form.nickName);
    let avatarUrl = safeText(this.data.form && this.data.form.avatarUrl);
    if (!nickName) {
      wx.showToast({ title: "请先填写昵称", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      if (avatarUrl && !isRemoteAvatar(avatarUrl)) {
        // issue #10: 上传失败时明确提示，不再静默把临时路径存库
        try {
          avatarUrl = await this.uploadAvatar(avatarUrl);
          if (!avatarUrl) {
            wx.showToast({ title: "头像上传失败，请重试", icon: "none" });
            this.setData({ saving: false });
            return;
          }
          this.setData({ "form.avatarUrl": avatarUrl, hasLocalAvatar: false });
        } catch (upErr) {
          console.warn("[profile-edit] uploadAvatar failed", upErr && upErr.message);
          wx.showToast({ title: "头像上传失败，请重试", icon: "none" });
          this.setData({ saving: false });
          return;
        }
      }
      const authPayload = { nickName };
      if (avatarUrl) authPayload.avatarUrl = avatarUrl;
      try { await syncAppLogin(authPayload); } catch (e) {}
      const profilePayload = {
        climbSkills: this.data.climbSkills,
        city: this.data.city,
        heightCm: this.data.heightCm,
        armspanCm: this.data.armspanCm,
        displayName: safeText(this.data.displayName),
        title: safeText(this.data.title),
        mbti: safeText(this.data.mbti),
        slogan: safeText(this.data.slogan)
      };
      if (profilePayload && profilePayload.climbSkills) {
        delete profilePayload.climbSkills.protector;
      }
      if (avatarUrl) profilePayload.avatarUrl = avatarUrl;
      profilePayload.nickName = nickName;
      const r = await userApi.updateProfile(profilePayload);
      if (r && r.me) {
        const app = getApp();
        if (app && app.globalData) app.globalData.me = r.me;
      }
      // issue #13 + #19: 一句话同步到主名片；无主卡时自动创建名片（新用户）
      const sloganText = safeText(this.data.slogan).trim();
      try {
        const myCard = await cardApi.listMy({});
        const primary = (myCard && myCard.myPrimaryCard) || null;
        if (primary && primary.cardId) {
          if (sloganText) await cardApi.updateOneLiner(primary.cardId, sloganText);
        } else if (sloganText || true) {
          // 新用户：用资料创建主名片（upsert 要求背面故事非空，用默认占位）
          await cardApi.upsert({
            card: {
              front: {
                displayName: safeText(this.data.displayName) || nickName,
                title: safeText(this.data.title),
                mbti: safeText(this.data.mbti),
                avatarMode: avatarUrl ? "custom" : "wechat",
                avatarFileId: avatarUrl || "",
                avatarUrl,
                oneLiner: sloganText,
                oneLinerStyle: "humor",
                wanderer: false,
                gyms: this.data.city ? [{ gymId: "", name: "", city: this.data.city }] : []
              },
              back: { story: "飞岩走壁，攀无止境" }
            }
          });
        }
      } catch (e) {
        console.warn("[profile-edit] card sync failed", e && e.message);
      }
      // issue #13: 手填新话入库（临时库，user_added 标记）
      if (sloganText && SLOGAN_POOL.indexOf(sloganText.replace(/^[\uD800-\uDBFF][\uDC00-\uDFFF]?\s*/, "")) < 0) {
        this.submitSloganToPool(sloganText.replace(/^[\uD800-\uDBFF][\uDC00-\uDFFF]?\s*/, ""));
      }
      try { cache.invalidate(cache.CACHE_KEYS.ME_PROFILE); } catch (_) {}
      try { cache.invalidate(cache.CACHE_KEYS.CARD_SUMMARY); } catch (_) {}
      try { cache.invalidate(cache.CACHE_KEYS.ME_PROFILE); } catch (_) {}
      wx.showToast({ title: "已保存", icon: "success" });
      setTimeout(() => { wx.navigateBack({ delta: 1 }); }, 500);
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  }
});
