import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage, type ProcessingResponse } from '../src/processing-worker';
function send(data:unknown) {
  const messages:ProcessingResponse[]=[];const transfers:Transferable[][]=[];
  handleMessage({data} as MessageEvent,{addEventListener(){},postMessage(message,transfer){messages.push(message);transfers.push(transfer||[]);}});
  assert.equal(messages.length,1);return {result:messages[0],transfer:transfers[0]};
}
test('worker rectifies and transfers output pixels',()=>{
  const source=new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]);
  const {result,transfer}=send({id:12,data:source.buffer,width:2,height:2,corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],outWidth:2,outHeight:2,mode:'whiteboard',strength:0});
  assert.ok('data' in result);assert.deepEqual(new Uint8ClampedArray(result.data),source);assert.equal(result.id,12);assert.deepEqual(transfer,[result.data]);
});
test('worker malformed requests return structured errors',()=>{
  for(const request of [null,{}, {id:2,data:new ArrayBuffer(4),width:2,height:2},{id:3,data:new ArrayBuffer(4),width:8193,height:1}]){
    const {result}=send(request);assert.ok('error' in result);assert.equal(typeof result.error,'string');
  }
});
test('worker rejects unsupported dimension-only and empty jobs',()=>{
  for(const extra of [{},{outWidth:2,outHeight:2},{strength:0.5}]){
    const {result}=send({id:8,data:new ArrayBuffer(16),width:2,height:2,...extra});assert.ok('error' in result);
  }
});
