import type { Point } from './processing';

/** 100% means contain/fit, not natural pixel size. Leave room for edge handles. */
export function fitPreviewSize(width:number,height:number,viewportWidth:number,viewportHeight:number,zoom=100,padding=12) {
  if (![width,height,viewportWidth,viewportHeight,zoom].every(n=>Number.isFinite(n)&&n>0)) throw new Error('Invalid preview dimensions.');
  const availableWidth=Math.max(1,viewportWidth-padding*2),availableHeight=Math.max(1,viewportHeight-padding*2);
  const fit=Math.min(availableWidth/width,availableHeight/height,1);
  return {width:Math.max(1,Math.floor(width*fit*zoom/100)),height:Math.max(1,Math.floor(height*fit*zoom/100))};
}

/** Drag in either direction and keep the corner order TL, TR, BR, BL. */
export function rectangleCorners(start:Point,end:Point):Point[] {
  const left=Math.min(start.x,end.x),right=Math.max(start.x,end.x),top=Math.min(start.y,end.y),bottom=Math.max(start.y,end.y);
  return [{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}];
}
