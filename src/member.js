"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var _a = require("ethers").utils, getAddress = _a.getAddress, BN = _a.BigNumber;
var MonoplasmaMember = /** @class */ (function () {
    function MonoplasmaMember(name, address, earnings, active) {
        if (active === void 0) { active = true; }
        this.name = name || "";
        this.address = getAddress(address);
        this.earnings = earnings ? new BN(earnings) : new BN(0);
        this.active = !!active;
    }
    MonoplasmaMember.prototype.addRevenue = function (amount) {
        this.earnings = this.earnings.add(new BN(amount));
    };
    MonoplasmaMember.prototype.isActive = function () {
        return !!this.active;
    };
    /**
     * @param {boolean} activeState true if active, false if not going to be getting revenues
     */
    MonoplasmaMember.prototype.setActive = function (activeState) {
        this.active = !!activeState;
    };
    MonoplasmaMember.prototype.toObject = function () {
        var obj = {
            address: this.address,
            earnings: this.earnings.toString(),
            active: !!this.active
        };
        if (this.name) {
            obj.name = this.name;
        }
        return obj;
    };
    MonoplasmaMember.prototype.clone = function () {
        return this.constructor.fromObject(this.toObject());
    };
    MonoplasmaMember.fromObject = function (obj) {
        return new MonoplasmaMember(obj.name, obj.address, obj.earnings, obj.active);
    };
    return MonoplasmaMember;
}());
exports.MonoplasmaMember = MonoplasmaMember;
//# sourceMappingURL=member.js.map