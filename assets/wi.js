/* The "i" bubbles, placed so they cannot be cut off.

   They used to be positioned absolutely against the icon and nudged sideways to
   stay on screen, which was enough while nothing around them clipped. It stopped
   being enough on the Flight Log, where the figures sit in a column that scrolls:
   any ancestor with overflow other than visible crops an absolutely positioned
   descendant, and half a sentence would disappear at the edge of the column.

   Fixed positioning is measured against the viewport instead, so no ancestor can
   clip it. The cost is that the bubble has to be placed on hover rather than by
   the stylesheet — it cannot inherit a position from an element it is no longer
   laid out inside. */

(function () {
  var pad = 10;

  Array.prototype.forEach.call(document.querySelectorAll('.wi'), function (w) {
    var pop = w.querySelector('.wi-pop');
    if (!pop) return;

    function place() {
      // reset before measuring: the previous placement would otherwise be
      // read back as this one's natural size
      pop.style.position = 'fixed';
      pop.style.left = '0px';
      pop.style.top = '0px';
      pop.style.bottom = 'auto';

      var icon = w.getBoundingClientRect();
      var box = pop.getBoundingClientRect();

      var left = icon.left;
      if (left + box.width > window.innerWidth - pad) {
        left = window.innerWidth - pad - box.width;
      }
      if (left < pad) left = pad;

      // above by preference, below when there is no room for it up there
      var top = icon.top - box.height - 6;
      if (top < pad) top = icon.bottom + 6;

      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
    }

    ['mouseenter', 'focus'].forEach(function (t) { w.addEventListener(t, place); });
  });
})();
