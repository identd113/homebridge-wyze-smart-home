const CameraModels = {
  WyzeCamv1Hd: "WYZEC1",
  WyzeCamV2: "WYZEC1-JZ",
  WyzeCamV3: "WYZE_CAKP2JFUS",
  WyzeCamV3Pro: "HL_CAM3P",
  WyzeCamV4: "HL_CAM4",
  WyzeCamFloodlight: "WYZE_CAKP2JFUS",
  WyzeCamPan: "WYZECP1_JEF",
  WyzeCamPanv2: "HL_PAN2",
  WyzeCamPanv3: "HL_PAN3",
  WyzeCamOutdoor: "WVOD1",
  WyzeCamOutdoor2: "HL_WCO2"
}
exports.CameraModels = CameraModels;

const OutdoorPlugModels = {
  WLPPOSUB: "WLPPO-SUB"
}
exports.OutdoorPlugModels = OutdoorPlugModels

const PlugModels = { WLPP1: "WLPP1", WLPP1CFH: "WLPP1CFH" }
exports.PlugModels = PlugModels

const LightModels = { BULB_WHITE: "WLPA19", BULB_WHITE_V2: "HL_HWB2" }
exports.LightModels = LightModels

const MeshLightModels = { MESH_BULB: "WLPA19C", HL_BR30C: "HL_BR30C", HL_A19C2: 'HL_A19C2' }
exports.MeshLightModels = MeshLightModels

const LightStripModels = { LIGHT_STRIP: "HL_LSL", LIGHT_STRIP_PRO: "HL_LSLP" }
exports.LightStripModels = LightStripModels

const ContactSensorModels = { "V1": "DWS2U", "V2": "DWS3U" }
exports.ContactSensorModels = ContactSensorModels

const MotionSensorModels = { V1: "PIR2U", V2: "PIR3U" }
exports.MotionSensorModels = MotionSensorModels

const LockModels = { YDLO1: "YD.LO1" }
exports.LockModels = LockModels

const LockBoltV2Models = { DX_LB2: "DX_LB2", DX_PVLOC: "DX_PVLOC" }
exports.LockBoltV2Models = LockBoltV2Models

const TemperatureHumidityModels = { TH3U: "TH3U" }
exports.TemperatureHumidityModels = TemperatureHumidityModels

const LeakSensorModels = { WS3U: "WS3U" }
exports.LeakSensorModels = LeakSensorModels

const CommonModels = { "LightSwitch": "LD_SS1" }
exports.CommonModels = CommonModels

const S1GatewayModels = { 'GW3U': 'GW3U' }
exports.S1GatewayModels = S1GatewayModels

const ThermostatModels = { CO_EA1: "CO_EA1" }
exports.ThermostatModels = ThermostatModels

const ThermostatRoomSensor = { CO_TH1: "CO_TH1" }
exports.ThermostatRoomSensor = ThermostatRoomSensor

const ModelNames = {
  // Locks
  "DX_LB2":          "Lock Bolt V2",
  "DX_PVLOC":        "Palm Lock",
  "YD.LO1":          "Lock",
  // Plugs
  "WLPP1":           "Plug",
  "WLPP1CFH":        "Plug",
  "WLPPO-SUB":       "Outdoor Plug (satellite)",
  // Lights
  "WLPA19":          "Bulb White",
  "HL_HWB2":         "Bulb White V2",
  "WLPA19C":         "Color Bulb",
  "HL_BR30C":        "BR30 Color Bulb",
  "HL_A19C2":        "A19 Color Bulb V2",
  "HL_LSL":          "Light Strip",
  "HL_LSLP":         "Light Strip Pro",
  // Sensors
  "DWS2U":           "Contact Sensor V1",
  "DWS3U":           "Contact Sensor V2",
  "PIR2U":           "Motion Sensor V1",
  "PIR3U":           "Motion Sensor V2",
  "WS3U":            "Leak Sensor",
  // Cameras
  "WYZEC1":          "Cam V1",
  "WYZEC1-JZ":       "Cam V2",
  "WYZE_CAKP2JFUS":  "Cam V3",
  "HL_CAM3P":        "Cam V3 Pro",
  "HL_CAM4":         "Cam V4",
  "WYZECP1_JEF":     "Cam Pan",
  "HL_PAN2":         "Cam Pan V2",
  "HL_PAN3":         "Cam Pan V3",
  "WVOD1":           "Cam Outdoor",
  "HL_WCO2":         "Cam Outdoor V2",
  // Other
  "TH3U":            "Temp/Humidity Sensor",
  "CO_EA1":          "Thermostat",
  "CO_TH1":          "Thermostat Room Sensor",
  "GW3U":            "S1 Gateway",
  "LD_SS1":          "Light Switch",
}
exports.ModelNames = ModelNames

//"OutdoorPlugMain" : "WLPPO", "ChimeSensor" : "CHIME", "HeadPhones":"JA_HP","YDGW1":"YD.GW1",
//"Scale_S":"WL_SC3","WL_SC2":"WL_SC2", "JA_RO2":"JA_RO2", "Sprinkler":"BS_WK1", "ThermostatRoomSensor":"CO_TH1",
//"BLE_Lock":"YD_BT1","JA_SL10":"JA_SL10"}
//WyzeCamPanPro: "HL_PANP",
//WyzeCamOutdoov2: "HL_WCO2",
//WyzeCamDoorbell: "WYZEDB3",
//WyzeBatteryCamPro: "AN_RSCW",
//WyzeCamDoorbellPro2: "AN_RDB1",
//WyzeCamFloodLightPro: "LD_CFP",
//WyzeCamDoorbellPro: "GW_BE1",
//WyzeCamOG: "GW_GC1",
//WyzeCamOGTelephoto3x: "GW_GC"
//VACUUM = ['JA_RO2']
//WyzeScale = ['JA.SC', 'JA.SC2']
//SCALE_S = ['WL_SC2']
//SCALE_X = ['WL_SC22135']
//WATCH = ['RA.WP1', 'RY.WA1']
//Wrist = ['RY.HP1']
