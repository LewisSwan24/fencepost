import { quizzes } from "./quiz-data.js";
export function createQuizState(speciesId) {
  return {
    speciesId: quizzes[speciesId] ? speciesId : "brushtail",
    question: 0,
    highlighted: 0,
    selected: null,
    feedback: false,
    answers: [null, null, null],
    completed: false,
    reviewing: false,
  };
}
export const correctCount = (state) =>
  quizzes[state.speciesId].filter((q, i) => state.answers[i] === q.correct)
    .length;
export function transition(state, action, value) {
  const questions = quizzes[state.speciesId];
  if (action === "restart") return createQuizState(state.speciesId);
  if (action === "animal") return createQuizState(value);
  if (action === "highlight") return { ...state, highlighted: value };
  if (action === "review" && state.completed)
    return { ...state, reviewing: true, highlighted: 0 };
  if (action === "summary" && state.completed)
    return { ...state, reviewing: false, highlighted: 0 };
  if (state.completed) return state;
  if (
    action === "answer" &&
    !state.feedback &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < 3
  ) {
    const answers = [...state.answers];
    answers[state.question] = value;
    return {
      ...state,
      answers,
      selected: value,
      feedback: true,
      highlighted: 0,
    };
  }
  if (action === "retry") {
    const answers = [...state.answers];
    answers[state.question] = null;
    return {
      ...state,
      answers,
      selected: null,
      feedback: false,
      highlighted: 0,
    };
  }
  if (action === "next" && state.feedback)
    return state.question === questions.length - 1
      ? {
          ...state,
          completed: true,
          feedback: false,
          selected: null,
          highlighted: 0,
        }
      : {
          ...state,
          question: state.question + 1,
          selected: null,
          feedback: false,
          highlighted: 0,
        };
  return state;
}
