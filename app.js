//函式庫元件設定
var WebSocketServer = require('ws').Server;
var http = require("http");
var express = require("express");
var app = express();
var port = process.env.PORT || 5000;
var server = http.createServer(app);
server.listen(port);
var wss = new WebSocketServer({server: server})

//全域變數設定
//1. 存在記憶體中的查閱表格
//ws頻道對應表，格式：   swk(sec-websocket-key)唯一值, 最後發送的資料(內包含頻道等等JSON格式)
var lookup = {};
//頻道id對應表，格式：   key(client 產生的頻道名), 頻道人員資訊(JSON格式，包含 id, 與當前每個玩家的遊戲狀態等等)
var channels = {};
//頻道變數對應表，格式： key(client 產生的頻道名), 遊戲變數或比賽變數資訊(JSON格式)
var gamevar = {};
//2. 連線 timeout 時間(秒)
var timeout = 1000;
//3. 每個頻道最多人數(id, 從 1 開始)
var limit = 4;

//socket server監聽
wss.on('connection', function(ws) {
	console.log("connection_PIXI_JACK");
	console.log("connection_PIXI_XYZ");
	console.log("connection_PIXI_123");

	//初次連線設定(僅執行一次)
	//1. 更新表格
	//連結建立時就要將 swk 資訊寫入表格，但頻道就需要等到 client 第一次傳訊息給 server 才會知道
	//如果在這段期間內斷線，因為沒有頻道資訊，自然就不用廣播，直接切斷該 ws 即可
	lookup[ws.upgradeReq.headers["sec-websocket-key"]] = {
		//以下是預設 JSON 資訊
		key: "", //頻道
		act: "", //動作
		id:  0,  //頻道內編號
		tt:  0   //(Server)頻道目前人數，平時動作更新時會被洗掉，只有 channel 與斷線時會同廣播到所有頻道中的人
	};
	//2. 一產生連線就要定期偵測心跳
	//var timer;
	//clearTimeout(timer);
	//timer = setTimeout(function() {
	//	ws.close();
	//}, (timeout*1000));
	//3. 確認本 ws 有無申請過頻道
	var is_channel = false;
	//監聽message事件(因為message只能傳輸字串，所以要序列化與反序列化)
	ws.on('message', function(data) {
		var data = JSON.parse(data);
		switch (data.act) {
			//頻道事件(連線後第一個一定要做的動作，沒有領到頻道與 id 將無法使用其他事件)
			case "channel":
				//0. 驗證格式
				console.log("data.key : " + data.act);
				console.log("sec-websocket-key : " + ws.upgradeReq.headers["sec-websocket-key"]);
				console.log("data.key : " + data.key);

				if (
					data.key.length == 8             //頻道長度要為八碼
					&& /[A-Za-z0-9]{8}/.test(data.key)  //頻道格式檢查
				) {
					//1. 更新表格，決定申請成功與否
					//頻道編號由 client 產生，但人數與 id 資訊由 server 製作
					if (!is_channel) {
						if (typeof(channels[data.key]) == "undefined") {
							ids = 1;
							channels[data.key] = {};
							//只有開頻道的人有資格取得遊戲變數
							if (typeof(gamevar[data.key]) == "undefined") {
								//之後要用外部 API 下載資訊，現在先用預設
								gamevar[data.key] = {
									base_score:    25,  //從 API 要來的每月最短秒數
									ch_top_score: 999, //目前頻道中所有玩家中最短者的秒數
									ch_top_id:      0, //目前頻道中最短秒數玩家的 id
								};
							}
						}
						//id 只會累加，不會補到斷線 id 的空洞中，因為遊戲有任一個人斷線就重來
						if (ids < limit+1) {
							//頻道人數在指定範圍內才配發 id ，不然就是 0
							channels[data.key][ws.upgradeReq.headers["sec-websocket-key"]] = {
								id:       ids, //id
								my_score: 999  //目前秒數
							};
							//才更新動作
							lookup[ws.upgradeReq.headers["sec-websocket-key"]] = data;
						}
						ids++;
					}
					//2. 確定 id 回傳給申請人
					data.act = "myid";
					if (!is_channel) data.id = channels[data.key][ws.upgradeReq.headers["sec-websocket-key"]].id;
					if (!is_channel) if (ids > limit+1) data.id = 0; //鎖定頻道最多只能 n 人
					ws.send(JSON.stringify(data));
					if (!is_channel) is_channel = true;
					//3. 將 id 與頻道人數資訊廣撥給頻道內所有人
					//注意當人數已滿時就不會再廣播，就算有人斷線產生空洞後再補新的人也不會有反應
					if (ids <= limit+1) {
						data.tt = (typeof(channels[data.key]) == "undefined") ? 0 : Object.keys(channels[data.key]).length; //頻道總人數
						data.act = "nowtotal";
						wss.clients.forEach(function(c) {
							//廣播給特定自己頻道的人
							//節縮頻寬、增加 CPU 、增加 MEM
							if (lookup[c.upgradeReq.headers["sec-websocket-key"]].key == data.key) {
								c.send(JSON.stringify(data));
							}
						});
					}
				}
				//4. break
				break;
			//一般常駐事件
			case "enter":
			case "buffer_web":
			case "buffer_mob":
			case "loadok_web":
			case "loadok_mob":
			case "mob":
				//0. 驗證身分
				if (
					lookup[ws.upgradeReq.headers["sec-websocket-key"]].key == data.key //server 與 client 所存的頻道相同時
					&& lookup[ws.upgradeReq.headers["sec-websocket-key"]].id  == data.id  //server 與 client 所存的 id 相同時
					&& (data.id >= 1 && data.id <= limit)                                //id 在容許範圍內
				) {
					//1. 當有被核可動作產生時就需要更新表格
					lookup[ws.upgradeReq.headers["sec-websocket-key"]] = data;
					//表格偵錯(平時註解)
					//for (var i = 0; i < Object.keys(lookup).length; i++) {
					//	var k = Object.keys(lookup)[i];
					//	var v = lookup[k];
					//	console.log(k + "," + v.key + "," + v.act + "," + v.id);
					//}
					//console.log("----------------------------------------");
					//2. 廣播
					wss.clients.forEach(function(c) {
						//廣播給特定自己頻道的人
						//節縮頻寬、增加 CPU 、增加 MEM
						if (lookup[c.upgradeReq.headers["sec-websocket-key"]].key == data.key) {
							c.send(JSON.stringify(data));
							//console.log(c.upgradeReq.headers["sec-websocket-key"]);
						}
					});
					//console.log("========================================");
				}
				//3. break
				break;
		}
		//節省記憶體用量做的 timeout ，一段時間沒有動作就切斷連結
		//clearTimeout(timer);
		//timer = setTimeout(function() {
		//	ws.close();
		//}, (timeout*1000));
	});
	//監聽斷線事件
	ws.on('close', function() {
		//頻道id對應表 中 刪除此人(如果有頻道的話)
		if (typeof(channels[lookup[ws.upgradeReq.headers["sec-websocket-key"]].key]) != "undefined") {
			delete channels[lookup[ws.upgradeReq.headers["sec-websocket-key"]].key][ws.upgradeReq.headers["sec-websocket-key"]];
			//如果刪除後頻道中沒有人了，就連頻道也刪除(包含以頻道為 key 的兩張表)
			if (Object.keys(channels[lookup[ws.upgradeReq.headers["sec-websocket-key"]].key]).length == 0) {
				delete channels[lookup[ws.upgradeReq.headers["sec-websocket-key"]].key];
				delete gamevar[lookup[ws.upgradeReq.headers["sec-websocket-key"]].key];
			}
		}
		//廣播
		wss.clients.forEach(function(c) {
			//廣播給特定自己頻道的人
			//節縮頻寬、增加 CPU 、增加 MEM
			if (lookup[c.upgradeReq.headers["sec-websocket-key"]].key == lookup[ws.upgradeReq.headers["sec-websocket-key"]].key) {
				//廣播斷線
				lookup[ws.upgradeReq.headers["sec-websocket-key"]].act = "dead";
				c.send(JSON.stringify(lookup[ws.upgradeReq.headers["sec-websocket-key"]]));
				//廣播頻道目前人數
				lookup[ws.upgradeReq.headers["sec-websocket-key"]].tt = (typeof(channels[lookup[ws.upgradeReq.headers["sec-websocket-key"]].key]) == "undefined") ? 0 : Object.keys(channels[lookup[ws.upgradeReq.headers["sec-websocket-key"]].key]).length; //頻道總人數
				lookup[ws.upgradeReq.headers["sec-websocket-key"]].act = "nowtotal";
				c.send(JSON.stringify(lookup[ws.upgradeReq.headers["sec-websocket-key"]]));
				//console.log(c.upgradeReq.headers["sec-websocket-key"]);
			}
		});
		//ws頻道對應表 中 刪除此 ws
		delete lookup[ws.upgradeReq.headers["sec-websocket-key"]]; //就算不存在也可以清除不會有錯誤
		//console.log("========================================");
	});
});
