// Gate: card markup is written once, in components/tabs/common.js.
//
// Hand-rolled card markup carries two costs. A surface or structure fix has to
// be found and applied at every call site — the 0.9.1 shading bug was exactly
// that, a collapsible head painting the card BODY shade because two idioms had
// drifted. And cards.css's .span hairline mask has to enumerate every card-like
// container class by hand, so a new container silently paints the page colour
// over a card and reads as a dark band across the row.
//
// One component means one place to fix and one selector to mask. This rule
// keeps it that way: no `class="card"`, `card-head` or `card-body` in a
// template outside the module that owns them.
//
// Escape hatch: a file whose card genuinely cannot be expressed by Card puts
// `/* eslint-disable hqptuner/no-hand-rolled-card -- <reason> */` at the top.
// It must carry a reason — an exemption you cannot justify in a clause is a
// capability that belongs in the component.
//
// `card-grid`, `card-title` and friends are untouched: they are layout and type
// classes, not the card frame.
const CARD_CLASS = /class="card(-head|-body)?["\s]/;

export default {
  meta: {
    type: "problem",
    docs: { description: "card markup belongs to components/tabs/common.js (docs/design-system.md)" },
    schema: [],
    messages: {
      handRolled:
        "hand-rolled card markup — import Card from tabs/common.js. A second copy of the card frame is how its surface drifts.",
    },
  },
  create(context) {
    return {
      TemplateElement(node) {
        if (CARD_CLASS.test(node.value.raw)) context.report({ node, messageId: "handRolled" });
      },
    };
  },
};
