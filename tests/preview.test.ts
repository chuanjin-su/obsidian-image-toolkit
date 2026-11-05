import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fitPreviewSize,rectangleCorners} from '../src/preview';

test('100% contains landscape test image by both width and height',()=>{
  const result=fitPreviewSize(5712,4284,800,500);
  assert.ok(result.width<=776&&result.height<=476);
  assert.equal(result.height,476);assert.equal(result.width,634);
});
test('fit respects whichever viewport dimension is limiting',()=>{
  const wide=fitPreviewSize(4000,1000,500,800),tall=fitPreviewSize(1000,4000,800,500);
  assert.deepEqual(wide,{width:476,height:119});assert.deepEqual(tall,{width:119,height:476});
});
test('zoom scales relative to fit, not viewport width',()=>{
  const base=fitPreviewSize(5712,4284,800,500),zoom=fitPreviewSize(5712,4284,800,500,200);
  assert.ok(Math.abs(zoom.width-base.width*2)<=1);assert.equal(zoom.height,base.height*2);
  assert.deepEqual(fitPreviewSize(100,50,800,500),{width:100,height:50});
});
test('rectangle selection in any drag direction orders corners consistently',()=>{
  const expected=[{x:10,y:20},{x:90,y:20},{x:90,y:70},{x:10,y:70}];
  assert.deepEqual(rectangleCorners({x:10,y:20},{x:90,y:70}),expected);
  assert.deepEqual(rectangleCorners({x:90,y:70},{x:10,y:20}),expected);
  assert.deepEqual(rectangleCorners({x:90,y:20},{x:10,y:70}),expected);
});
